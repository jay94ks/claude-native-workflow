-- 설계자 요청(2026-09-21 후속) - 웹 접속 path를 /{생성자 login명}/{project id}로
-- 바꾸기 위해 Project에 영구적인 "생성자" 기록이 필요해졌다. 기존 프로젝트는
-- 실제 생성자 이력이 따로 없으므로, 그 프로젝트의 현재 ADMIN을 최선의 대체값으로
-- 백필한다(이 시점까지는 ADMIN이 곧 생성자였던 경우가 대부분 - project.transfer로
-- Admin이 넘어간 적 있는 기존 프로젝트만 실제 생성자와 다를 수 있다는 걸 알아둔다).
-- 컬럼을 처음부터 NOT NULL로 추가할 수 없어서(기존 행이 있으므로) nullable로
-- 추가 -> 백필 -> NOT NULL 전환 -> FK 순서로 진행한다.

-- AlterTable (nullable 먼저)
ALTER TABLE "Project" ADD COLUMN "creatorAccountId" TEXT;

-- Backfill: 각 프로젝트의 현재 ADMIN 멤버로 채운다.
UPDATE "Project" p
SET "creatorAccountId" = (
  SELECT m."accountId" FROM "ProjectMembership" m
  WHERE m."projectId" = p.id AND m.role = 'ADMIN'
  LIMIT 1
)
WHERE p."creatorAccountId" IS NULL;

-- AlterTable (NOT NULL로 전환)
ALTER TABLE "Project" ALTER COLUMN "creatorAccountId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_creatorAccountId_fkey" FOREIGN KEY ("creatorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
