/*
  Warnings:

  - You are about to drop the column `entry_index_edit` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `lv2_edit` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `lv2_scope` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `lv2_view` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `lv3_edit` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `lv3_scope` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `lv3_view` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the column `master_id` on the `InterfaceConfig` table. All the data in the column will be lost.
  - You are about to drop the `MasterData` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "InterfaceConfig" DROP COLUMN "entry_index_edit",
DROP COLUMN "lv2_edit",
DROP COLUMN "lv2_scope",
DROP COLUMN "lv2_view",
DROP COLUMN "lv3_edit",
DROP COLUMN "lv3_scope",
DROP COLUMN "lv3_view",
DROP COLUMN "master_id",
ADD COLUMN     "description" TEXT DEFAULT '',
ADD COLUMN     "edit_role_ids" JSONB DEFAULT '[]',
ADD COLUMN     "is_master" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "master_editor_id" TEXT,
ADD COLUMN     "task_masters" JSONB DEFAULT '[]',
ADD COLUMN     "view_scopes" JSONB DEFAULT '[]',
ALTER COLUMN "icon" SET DEFAULT '📦',
ALTER COLUMN "org_ids" SET DEFAULT '[]';

-- DropTable
DROP TABLE "MasterData";

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "main_headline" TEXT NOT NULL DEFAULT '서비스 센터',
    "sub_headline" TEXT NOT NULL DEFAULT 'AX 기반 스마트 오피스 모듈을 선택하세요.',
    "home_grid_cols" INTEGER NOT NULL DEFAULT 4,
    "layout_type" TEXT NOT NULL DEFAULT 'horizontal',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterCode" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT NOT NULL,
    "orgs" TEXT[],
    "min_qty" TEXT,
    "unit" TEXT,
    "price" DOUBLE PRECISION,
    "vendor" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "in_use" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MasterCode_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MasterCode" ADD CONSTRAINT "MasterCode_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "MasterGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
