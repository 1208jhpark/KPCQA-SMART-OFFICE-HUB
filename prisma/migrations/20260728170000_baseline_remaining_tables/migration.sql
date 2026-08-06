-- Baseline: business tables + core columns missing from early migrations
-- Idempotent for DBs that already received schema via db push

-- ========== Core table column catch-up ==========
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name_en" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "employee_no" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "duty" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "duty_en" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "grade" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "grade_en" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "must_reset_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "password_reset_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "password_reset_requested_at" TIMESTAMP(3);

ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "unit_name_en" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "supply_storage_note" TEXT NOT NULL DEFAULT '';

ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT '';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "view_scopes" JSONB DEFAULT '[]';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "org_ids" JSONB DEFAULT '[]';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "edit_role_ids" JSONB DEFAULT '[]';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "edit_scopes" JSONB DEFAULT '[]';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "task_masters" JSONB DEFAULT '[]';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "view_role_ids" JSONB;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "task_accesses" JSONB;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "is_master" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "master_editor_id" TEXT;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "entry_sidebar" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "entry_index_view" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "entry_l4_direct" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "l2_entry_mode" TEXT DEFAULT 'L3_DEFAULT';
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "show_header" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "page_title" TEXT;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "show_page_title" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "page_description" TEXT;
ALTER TABLE "InterfaceConfig" ADD COLUMN IF NOT EXISTS "show_page_desc" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "linked_sites" JSONB DEFAULT '[]';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "audit_baseline" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "global_mgmt_dept" TEXT NOT NULL DEFAULT '경영기획본부';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "client_category_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "supply_category_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "unit_category_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "it_category_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "it_rental_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "it_master_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "job_duty_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "job_grade_group" TEXT NOT NULL DEFAULT '';

ALTER TABLE "MasterGroup" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "MasterGroup" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MasterCode" ADD COLUMN IF NOT EXISTS "value" TEXT;

-- MasterGroup.name unique (may already exist)
CREATE UNIQUE INDEX IF NOT EXISTS "MasterGroup_name_key" ON "MasterGroup"("name");

-- ========== Missing business tables ==========

-- CreateTable Vendor
CREATE TABLE IF NOT EXISTS "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "services" TEXT[],
    "contact" TEXT,
    "category" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable MarketingItem
CREATE TABLE IF NOT EXISTS "MarketingItem" (
    "id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL DEFAULT 'CENTER',
    "owner_dept" TEXT,
    "name" TEXT NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "alert_qty" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT DEFAULT '',
    "description" TEXT DEFAULT '',
    "unit" TEXT DEFAULT 'EA',
    "is_archived" BOOLEAN DEFAULT false,
    "creator_name" TEXT,
    "creator_dept" TEXT,
    "creator_email" TEXT,
    "archived_by_name" TEXT,
    "archived_by_dept" TEXT,
    "archived_by_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable MarketingClient
CREATE TABLE IF NOT EXISTS "MarketingClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "category" TEXT,
    "departments" JSONB DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "archived_by_name" TEXT,
    "archived_by_dept" TEXT,
    "archived_by_email" TEXT,
    "creator_name" TEXT,
    "creator_dept" TEXT,
    "creator_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable SupplyItem
CREATE TABLE IF NOT EXISTS "SupplyItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "alert_qty" INTEGER NOT NULL DEFAULT 0,
    "owner_dept" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeliverySurvey
CREATE TABLE IF NOT EXISTS "DeliverySurvey" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "postNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "deliveryType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "postDate" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '게시전',
    "hasBeenPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "questions" JSONB DEFAULT '[]',
    "nudgedUsers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "endTime" TEXT DEFAULT '23:59',

    CONSTRAINT "DeliverySurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable GeneralSurvey
CREATE TABLE IF NOT EXISTS "GeneralSurvey" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "postNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "target" TEXT NOT NULL,
    "postDate" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '게시전',
    "hasBeenPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "questions" JSONB DEFAULT '[]',
    "nudgedUsers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "endTime" TEXT DEFAULT '23:59',

    CONSTRAINT "GeneralSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable ITAudit
CREATE TABLE IF NOT EXISTS "ITAudit" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '작성중',
    "postDate" TEXT,
    "archivedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ITAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable BusinessCardOrderBatch
CREATE TABLE IF NOT EXISTS "BusinessCardOrderBatch" (
    "id" TEXT NOT NULL,
    "orderDate" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "deptHeadGroup" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '발주완료',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCardOrderBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable ITAsset
CREATE TABLE IF NOT EXISTS "ITAsset" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "it_type" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "user" TEXT DEFAULT '공용',
    "code" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sn" TEXT,
    "brand" TEXT,
    "spec" TEXT,
    "is_rental" TEXT NOT NULL DEFAULT '구매',
    "rental_months" INTEGER NOT NULL DEFAULT 0,
    "purchase_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_sub_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "in_date" TEXT,
    "start_date" TEXT,
    "end_date" TEXT,
    "first_bill" TEXT,
    "cycle" INTEGER NOT NULL DEFAULT 48,
    "memo" TEXT DEFAULT '-',
    "reg_date" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "last_audit_date" TEXT,
    "audit_request_date" TEXT,

    CONSTRAINT "ITAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable MarketingDistribution
CREATE TABLE IF NOT EXISTS "MarketingDistribution" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT NOT NULL,
    "client_dept" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT,
    "sender_name" TEXT NOT NULL,
    "sender_dept" TEXT NOT NULL,
    "sender_email" TEXT,
    "dist_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable MarketingPurchase
CREATE TABLE IF NOT EXISTS "MarketingPurchase" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "purchaser_name" TEXT NOT NULL,
    "purchaser_dept" TEXT NOT NULL,
    "purchaser_email" TEXT,
    "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT,
    "vendor_id" TEXT,

    CONSTRAINT "MarketingPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable SupplyPurchase
CREATE TABLE IF NOT EXISTS "SupplyPurchase" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "total_price" INTEGER NOT NULL,
    "note" TEXT,
    "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaser_name" TEXT NOT NULL,
    "purchaser_dept" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT,
    "vendor_id" TEXT,

    CONSTRAINT "SupplyPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable SupplyRequest
CREATE TABLE IF NOT EXISTS "SupplyRequest" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "dept_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_opinion" TEXT,
    "admin_name" TEXT,
    "admin_dept" TEXT,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeliveryResponse
CREATE TABLE IF NOT EXISTS "DeliveryResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answers" JSONB NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "feedbackMsg" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeliveryResponseEvent
CREATE TABLE IF NOT EXISTS "DeliveryResponseEvent" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "revisionNo" INTEGER,
    "message" TEXT,
    "answers" JSONB,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryResponseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable GeneralResponse
CREATE TABLE IF NOT EXISTS "GeneralResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answers" JSONB NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GeneralResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable ITAuditResponse
CREATE TABLE IF NOT EXISTS "ITAuditResponse" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "date" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ITAuditResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable ITRequest
CREATE TABLE IF NOT EXISTS "ITRequest" (
    "id" TEXT NOT NULL,
    "requestDate" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "assetInfo" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '의견전송',
    "adminOpinion" TEXT,
    "completedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ITRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable ITAssetArchive
CREATE TABLE IF NOT EXISTS "ITAssetArchive" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "it_type" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "user" TEXT,
    "code" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sn" TEXT,
    "brand" TEXT,
    "spec" TEXT,
    "is_rental" TEXT NOT NULL,
    "purchase_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_sub_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "in_date" TEXT,
    "end_date" TEXT,
    "first_bill" TEXT,
    "cycle" INTEGER NOT NULL DEFAULT 48,
    "memo" TEXT,
    "reg_date" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "reseller" TEXT,
    "resellPrice" DOUBLE PRECISION DEFAULT 0,
    "terminated_at" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ITAssetArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable BusinessCardRequest
CREATE TABLE IF NOT EXISTS "BusinessCardRequest" (
    "id" TEXT NOT NULL,
    "postNumber" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "userName" TEXT NOT NULL,
    "applyDate" TEXT NOT NULL,
    "processDate" TEXT,
    "addressId" TEXT,
    "deptHead" TEXT NOT NULL,
    "deptName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "additionalKo" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "mobile" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "addressKo" TEXT NOT NULL,
    "fax" TEXT NOT NULL,
    "userNameEn" TEXT NOT NULL,
    "deptHeadEn" TEXT NOT NULL,
    "deptNameEn" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "additionalEn" TEXT,
    "addressEn" TEXT NOT NULL,
    "mobileEn" TEXT NOT NULL,
    "phoneEn" TEXT NOT NULL,
    "faxEn" TEXT NOT NULL,
    "emailEn" TEXT NOT NULL,
    "userStatus" TEXT NOT NULL DEFAULT '1차작성',
    "adminStatus" TEXT NOT NULL DEFAULT '대기중',
    "adminFeedback" TEXT,
    "orderGroupId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "isModifiedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "adminMemo" TEXT,
    "adminModifierName" TEXT,
    "adminModifiedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessCardRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable CompanyAddress
CREATE TABLE IF NOT EXISTS "CompanyAddress" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "addressKo" TEXT NOT NULL,
    "addressEn" TEXT NOT NULL,
    "fax" TEXT NOT NULL,
    "faxEn" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable BusinessCardQualification
CREATE TABLE IF NOT EXISTS "BusinessCardQualification" (
    "id" TEXT NOT NULL,
    "nameKo" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessCardQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable OutsourcingVendor
CREATE TABLE IF NOT EXISTS "OutsourcingVendor" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "managerName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutsourcingVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProductionRequest
CREATE TABLE IF NOT EXISTS "ProductionRequest" (
    "id" TEXT NOT NULL,
    "postNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "deptHead" TEXT NOT NULL,
    "deptName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "estimatedPrice" INTEGER NOT NULL DEFAULT 0,
    "finalPrice" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "batchId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProductionPlateMaster
CREATE TABLE IF NOT EXISTS "ProductionPlateMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "size" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlateMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProductionCertMaster
CREATE TABLE IF NOT EXISTS "ProductionCertMaster" (
    "id" TEXT NOT NULL,
    "certId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT '',
    "jebonFormat" TEXT NOT NULL DEFAULT '',
    "grades" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionCertMaster_pkey" PRIMARY KEY ("id")
);

-- ========== Indexes ==========
CREATE UNIQUE INDEX IF NOT EXISTS "ITAsset_code_key" ON "ITAsset"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryResponse_surveyId_userEmail_key" ON "DeliveryResponse"("surveyId", "userEmail");
CREATE INDEX IF NOT EXISTS "DeliveryResponseEvent_surveyId_userEmail_createdAt_idx" ON "DeliveryResponseEvent"("surveyId", "userEmail", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GeneralResponse_surveyId_userEmail_key" ON "GeneralResponse"("surveyId", "userEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "ITAuditResponse_auditId_userEmail_key" ON "ITAuditResponse"("auditId", "userEmail");
CREATE INDEX IF NOT EXISTS "BusinessCardRequest_userEmail_idx" ON "BusinessCardRequest"("userEmail");
CREATE INDEX IF NOT EXISTS "BusinessCardRequest_orderGroupId_idx" ON "BusinessCardRequest"("orderGroupId");
CREATE INDEX IF NOT EXISTS "BusinessCardRequest_adminStatus_idx" ON "BusinessCardRequest"("adminStatus");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionRequest_postNumber_key" ON "ProductionRequest"("postNumber");
CREATE INDEX IF NOT EXISTS "ProductionRequest_deptName_idx" ON "ProductionRequest"("deptName");
CREATE INDEX IF NOT EXISTS "ProductionRequest_status_idx" ON "ProductionRequest"("status");
CREATE INDEX IF NOT EXISTS "ProductionRequest_batchId_idx" ON "ProductionRequest"("batchId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionPlateMaster_code_key" ON "ProductionPlateMaster"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionCertMaster_certId_key" ON "ProductionCertMaster"("certId");

-- ========== Foreign keys ==========
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingDistribution_item_id_fkey'
  ) THEN
    ALTER TABLE "MarketingDistribution"
      ADD CONSTRAINT "MarketingDistribution_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "MarketingItem"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingDistribution_client_id_fkey'
  ) THEN
    ALTER TABLE "MarketingDistribution"
      ADD CONSTRAINT "MarketingDistribution_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "MarketingClient"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingPurchase_item_id_fkey'
  ) THEN
    ALTER TABLE "MarketingPurchase"
      ADD CONSTRAINT "MarketingPurchase_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "MarketingItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingPurchase_vendor_id_fkey'
  ) THEN
    ALTER TABLE "MarketingPurchase"
      ADD CONSTRAINT "MarketingPurchase_vendor_id_fkey"
      FOREIGN KEY ("vendor_id") REFERENCES "Vendor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplyPurchase_item_id_fkey'
  ) THEN
    ALTER TABLE "SupplyPurchase"
      ADD CONSTRAINT "SupplyPurchase_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "SupplyItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplyPurchase_vendor_id_fkey'
  ) THEN
    ALTER TABLE "SupplyPurchase"
      ADD CONSTRAINT "SupplyPurchase_vendor_id_fkey"
      FOREIGN KEY ("vendor_id") REFERENCES "Vendor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplyRequest_item_id_fkey'
  ) THEN
    ALTER TABLE "SupplyRequest"
      ADD CONSTRAINT "SupplyRequest_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "SupplyItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryResponse_surveyId_fkey'
  ) THEN
    ALTER TABLE "DeliveryResponse"
      ADD CONSTRAINT "DeliveryResponse_surveyId_fkey"
      FOREIGN KEY ("surveyId") REFERENCES "DeliverySurvey"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GeneralResponse_surveyId_fkey'
  ) THEN
    ALTER TABLE "GeneralResponse"
      ADD CONSTRAINT "GeneralResponse_surveyId_fkey"
      FOREIGN KEY ("surveyId") REFERENCES "GeneralSurvey"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ITAuditResponse_auditId_fkey'
  ) THEN
    ALTER TABLE "ITAuditResponse"
      ADD CONSTRAINT "ITAuditResponse_auditId_fkey"
      FOREIGN KEY ("auditId") REFERENCES "ITAudit"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BusinessCardRequest_orderGroupId_fkey'
  ) THEN
    ALTER TABLE "BusinessCardRequest"
      ADD CONSTRAINT "BusinessCardRequest_orderGroupId_fkey"
      FOREIGN KEY ("orderGroupId") REFERENCES "BusinessCardOrderBatch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

