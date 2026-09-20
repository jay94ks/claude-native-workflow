-- AlterTable
ALTER TABLE "Document" DROP COLUMN "dependsOn",
DROP COLUMN "related";

-- CreateTable
CREATE TABLE "DocumentRelated" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "etag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRelated_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDependsOn" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "etag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDependsOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRelated_targetId_idx" ON "DocumentRelated"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRelated_documentId_targetId_key" ON "DocumentRelated"("documentId", "targetId");

-- CreateIndex
CREATE INDEX "DocumentDependsOn_targetId_idx" ON "DocumentDependsOn"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDependsOn_documentId_targetId_key" ON "DocumentDependsOn"("documentId", "targetId");

-- AddForeignKey
ALTER TABLE "DocumentRelated" ADD CONSTRAINT "DocumentRelated_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRelated" ADD CONSTRAINT "DocumentRelated_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDependsOn" ADD CONSTRAINT "DocumentDependsOn_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDependsOn" ADD CONSTRAINT "DocumentDependsOn_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

