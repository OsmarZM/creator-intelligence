-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "creators" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "accountId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "campaign" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "product" TEXT,
    "campaign" TEXT,
    "coupon" TEXT,
    "status" TEXT NOT NULL DEFAULT 'valid',
    "importId" TEXT NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_records" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "entity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "importId" TEXT NOT NULL,

    CONSTRAINT "metric_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_changes" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "previous" JSONB,
    "targetId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "pending_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creators_slug_key" ON "creators"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_creatorId_platform_handle_key" ON "social_accounts"("creatorId", "platform", "handle");

-- CreateIndex
CREATE INDEX "posts_creatorId_publishedAt_idx" ON "posts"("creatorId", "publishedAt");

-- CreateIndex
CREATE INDEX "sales_creatorId_date_idx" ON "sales"("creatorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_creatorId_source_externalId_key" ON "sales"("creatorId", "source", "externalId");

-- CreateIndex
CREATE INDEX "metric_records_creatorId_metric_endDate_idx" ON "metric_records"("creatorId", "metric", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "metric_records_creatorId_metric_kind_startDate_endDate_enti_key" ON "metric_records"("creatorId", "metric", "kind", "startDate", "endDate", "entity", "source");

-- CreateIndex
CREATE UNIQUE INDEX "imports_creatorId_hash_key" ON "imports"("creatorId", "hash");

-- CreateIndex
CREATE INDEX "audit_logs_importId_idx" ON "audit_logs"("importId");

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_changes" ADD CONSTRAINT "pending_changes_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
