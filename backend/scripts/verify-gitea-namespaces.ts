// migrate-gitea-namespaces.ts로 이전한 결과를 검증한다 - 모든
// ProjectGitRepo 행에 대해 새 프로젝트별 org/저장소 이름 위치에
// 실제로 저장소가 존재하고(GET 200) 살아있는지(커밋 1개 조회 성공)
// 확인한다. `npm run verify:gitea-namespaces`로 수동 실행.

import { connectDb, getDb, disconnectDb } from "../src/core/db.js";
import { selfHostedRef, mirrorRef, workRef, type GiteaRepoRef } from "../src/core/gitRepos.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 필요합니다`);
  return v;
}

async function giteaFetch(pathSuffix: string): Promise<Response> {
  return fetch(`${requireEnv("GITEA_API_URL")}${pathSuffix}`, {
    headers: { Authorization: `token ${requireEnv("GITEA_API_TOKEN")}` },
  });
}

async function checkRepoExists(target: GiteaRepoRef): Promise<boolean> {
  const res = await giteaFetch(`/api/v1/repos/${target.org}/${target.repo}`);
  return res.ok;
}

async function checkRepoLive(target: GiteaRepoRef): Promise<boolean> {
  const res = await giteaFetch(`/api/v1/repos/${target.org}/${target.repo}/commits?limit=1`);
  return res.ok;
}

interface ProjectRepoRow {
  projectId: string;
  provider: string;
}

interface ResultRow {
  projectId: string;
  provider: string;
  target: string;
  status: "ok" | "missing" | "not-live";
}

async function main() {
  await connectDb();
  const db = getDb();
  const rows = (await db.projectGitRepo.findMany({ select: { projectId: true, provider: true } })) as ProjectRepoRow[];

  const results: ResultRow[] = [];

  for (const row of rows) {
    const targets: GiteaRepoRef[] =
      row.provider === "self_hosted"
        ? [selfHostedRef(row.projectId)]
        : row.provider === "external_linked"
          ? [mirrorRef(row.projectId), workRef(row.projectId)]
          : [];

    for (const target of targets) {
      const exists = await checkRepoExists(target);
      if (!exists) {
        results.push({ projectId: row.projectId, provider: row.provider, target: `${target.org}/${target.repo}`, status: "missing" });
        continue;
      }
      const live = await checkRepoLive(target);
      results.push({
        projectId: row.projectId,
        provider: row.provider,
        target: `${target.org}/${target.repo}`,
        status: live ? "ok" : "not-live",
      });
    }
  }

  console.table(results);
  const failedCount = results.filter((r) => r.status !== "ok").length;
  console.log(`총 ${results.length}건 - 실패 ${failedCount}건`);
  if (failedCount > 0) process.exitCode = 1;

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
