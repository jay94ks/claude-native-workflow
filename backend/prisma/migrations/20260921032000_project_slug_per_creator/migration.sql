-- 설계자 요청(2026-09-21 후속) - "프로젝트 id는 설계자별로 관리되어야 한다"
-- (서로 다른 두 설계자가 같은 id로 각자 프로젝트를 가질 수 있어야 함).
-- Project.id(cuid)는 내부 전역 유일 PK로 그대로 두고, 새로 추가하는 slug
-- 컬럼이 "밖에서 부르는 프로젝트 id"가 된다 - creatorAccountId 범위에서만
-- 유일하다. 기존 행(들)은 지금까지 그 자체가 곧 "밖에서 부르는 id"였던
-- Project.id 값을 그대로 slug로 백필한다(예: "demo-project") - 기존
-- CLI/북마크가 그 문자열을 그대로 계속 쓸 수 있게 하기 위해서다.

-- AlterTable (nullable 먼저 - 기존 행이 있어 NOT NULL로 바로 추가 불가)
ALTER TABLE "Project" ADD COLUMN "slug" TEXT;

-- Backfill
UPDATE "Project" SET "slug" = "id" WHERE "slug" IS NULL;

-- AlterTable (NOT NULL로 전환)
ALTER TABLE "Project" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Project_creatorAccountId_slug_key" ON "Project"("creatorAccountId", "slug");
