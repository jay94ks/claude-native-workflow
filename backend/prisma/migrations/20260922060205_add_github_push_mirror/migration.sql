-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pushMirrorGithubAccountId" TEXT;

-- CreateTable
CREATE TABLE "GithubCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "githubLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubCredential_accountId_key" ON "GithubCredential"("accountId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_pushMirrorGithubAccountId_fkey" FOREIGN KEY ("pushMirrorGithubAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubCredential" ADD CONSTRAINT "GithubCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
