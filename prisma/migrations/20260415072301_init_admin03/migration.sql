-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '["LV_3"]',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "unit_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "unit_name" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterfaceConfig" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" TEXT,
    "org_ids" JSONB,
    "master_id" TEXT,
    "lv2_view" BOOLEAN NOT NULL DEFAULT true,
    "lv2_edit" BOOLEAN NOT NULL DEFAULT false,
    "lv2_scope" JSONB,
    "lv3_view" BOOLEAN NOT NULL DEFAULT true,
    "lv3_edit" BOOLEAN NOT NULL DEFAULT false,
    "lv3_scope" JSONB,
    "entry_sidebar" BOOLEAN NOT NULL DEFAULT true,
    "entry_index_view" BOOLEAN NOT NULL DEFAULT true,
    "entry_index_edit" BOOLEAN NOT NULL DEFAULT false,
    "entry_l4_direct" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterfaceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterData" (
    "id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "min_stock_qty" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "price_krw" INTEGER NOT NULL DEFAULT 0,
    "vendor" TEXT,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MasterData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InterfaceConfig_path_key" ON "InterfaceConfig"("path");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterfaceConfig" ADD CONSTRAINT "InterfaceConfig_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "InterfaceConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
