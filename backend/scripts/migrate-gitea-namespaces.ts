// 기존(공유 org "cnwk-projects" + slug 접미사) 스킴으로 만들어진 모든
// 프로젝트의 Gitea 저장소를 새 프로젝트별 네임스페이스 스킴
// (#gitea-per-project-namespace - org 하나당 프로젝트 하나, 저장소
// 이름은 "repo"/"work"/"mirror" 고정)으로 실제 이전한다. 1회성
// 업그레이드 스크립트 - `npm run migrate:gitea-namespaces`로 수동
// 실행한다(docker-entrypoint.sh에는 절대 자동 연결하지 않음 - 이
// 저장소의 기존 원칙: db push는 자동, 콘텐츠/데이터 마이그레이션은
// 항상 수동).
//
// 멱등 - 이미 새 위치에 저장소가 있으면(재실행 시 등) 그 항목은
// 건너뛴다. 각 저장소는 먼저 Gitea의 저장소 이전(transfer) API를
// 시도하고, 실패하면 `git clone --mirror` + `git push --mirror` 폴백
// 으로 히스토리를 그대로 복사한 뒤 레거시 저장소를 지운다.
//
// **확인 필요**(추측 금지 - 실제 인스턴스로 재확인):
// - `POST /repos/{owner}/{repo}/transfer`가 org 대상일 때 즉시
//   완료되는지, 별도 accept 단계가 필요한지(버전별 상이 가능).
// - transfer 실패 시 폴백 경로가 실제로 필요한지(성공하면 안 쓰임).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDb, getDb, disconnectDb } from "../src/core/db.js";
import { ensureProjectOrgConfigured } from "../src/core/gitRepos.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 필요합니다`);
  return v;
}

function apiUrl(): string {
  return requireEnv("GITEA_API_URL");
}
function adminToken(): string {
  return requireEnv("GITEA_API_TOKEN");
}
function adminUsername(): string {
  return requireEnv("GITEA_ADMIN_USERNAME");
}

async function giteaFetch(pathSuffix: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiUrl()}${pathSuffix}`, {
    ...init,
    headers: {
      Authorization: `token ${adminToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return res;
}

// 레거시 스킴(gitRepos.ts에서 완전히 제거됨 - 이 1회성 스크립트 안에만
// 고정 재현해둔다) - GITEA_ORG_NAME은 이 마이그레이션이 끝나면 더 이상
// 아무 데도 안 쓰인다.
const LEGACY_ORG = process.env.GITEA_ORG_NAME || "cnwk-projects";
function legacySlug(projectId: string): string {
  return `project-${projectId}`;
}
function legacyMirrorSlug(projectId: string): string {
  return `${legacySlug(projectId)}-mirror`;
}
function legacyWorkSlug(projectId: string): string {
  return `${legacySlug(projectId)}-work`;
}

async function repoExists(org: string, repo: string): Promise<boolean> {
  const res = await giteaFetch(`/api/v1/repos/${org}/${repo}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`저장소 조회 실패(${org}/${repo}): HTTP ${res.status}`);
  return true;
}

async function getCloneUrl(org: string, repo: string): Promise<string | null> {
  const res = await giteaFetch(`/api/v1/repos/${org}/${repo}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { clone_url?: string };
  return json.clone_url ?? null;
}

async function transferRepo(legacyRepoSlug: string, newOrg: string): Promise<void> {
  const res = await giteaFetch(`/api/v1/repos/${LEGACY_ORG}/${legacyRepoSlug}/transfer`, {
    method: "POST",
    body: JSON.stringify({ new_owner: newOrg }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`transfer 실패: HTTP ${res.status} ${body}`);
  }
}

async function renameRepo(org: string, oldName: string, newName: string): Promise<void> {
  const res = await giteaFetch(`/api/v1/repos/${org}/${oldName}`, {
    method: "PATCH",
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`rename 실패: HTTP ${res.status} ${body}`);
  }
}

async function deleteRepo(org: string, repo: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${org}/${repo}`, { method: "DELETE" });
}

/** transfer API가 실패할 때(버전 차이/설정 등)의 폴백 - 순수 git
 * 프로토콜로 히스토리를 통째로 복사한다(브랜치/태그 전부 보존, 단
 * 이슈/PR/코멘트 등 Gitea 메타데이터는 안 옮겨짐 - 이 시스템은 그
 * 메타데이터에 의존하지 않으므로 문제 없음). */
function mirrorCloneFallback(legacyRepoSlug: string, newOrg: string, newRepoName: string): void {
  const url = new URL(apiUrl());
  const cred = `${encodeURIComponent(adminUsername())}:${encodeURIComponent(adminToken())}`;
  const srcUrl = `${url.protocol}//${cred}@${url.host}/${LEGACY_ORG}/${legacyRepoSlug}.git`;
  const dstUrl = `${url.protocol}//${cred}@${url.host}/${newOrg}/${newRepoName}.git`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitea-ns-migrate-"));
  const mirrorDir = path.join(tmpDir, "mirror.git");
  try {
    execFileSync("git", ["clone", "--mirror", srcUrl, mirrorDir], { stdio: "pipe" });
    execFileSync("git", ["push", "--mirror", dstUrl], { cwd: mirrorDir, stdio: "pipe" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

interface MigrateTask {
  legacyRepoSlug: string;
  newRepoName: string;
}

interface ProjectRepoRow {
  projectId: string;
  provider: string;
}

interface ResultRow {
  projectId: string;
  provider: string;
  status: "migrated" | "already-migrated" | "skipped" | "failed";
  detail: string;
}

async function migrateOneTask(newOrg: string, task: MigrateTask): Promise<{ ok: boolean; alreadyDone: boolean; detail: string }> {
  if (await repoExists(newOrg, task.newRepoName)) {
    return { ok: true, alreadyDone: true, detail: `${task.newRepoName}: 이미 이전됨(스킵)` };
  }
  try {
    await transferRepo(task.legacyRepoSlug, newOrg);
    await renameRepo(newOrg, task.legacyRepoSlug, task.newRepoName);
    return { ok: true, alreadyDone: false, detail: `${task.newRepoName}: transfer 성공` };
  } catch (transferErr) {
    try {
      mirrorCloneFallback(task.legacyRepoSlug, newOrg, task.newRepoName);
      await deleteRepo(LEGACY_ORG, task.legacyRepoSlug);
      return { ok: true, alreadyDone: false, detail: `${task.newRepoName}: mirror-clone 폴백 성공` };
    } catch (fallbackErr) {
      const msg1 = transferErr instanceof Error ? transferErr.message : String(transferErr);
      const msg2 = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      return { ok: false, alreadyDone: false, detail: `${task.newRepoName}: 실패(transfer: ${msg1} / fallback: ${msg2})` };
    }
  }
}

async function main() {
  await connectDb();
  const db = getDb();
  const rows = (await db.projectGitRepo.findMany({ select: { projectId: true, provider: true } })) as ProjectRepoRow[];

  const results: ResultRow[] = [];

  for (const row of rows) {
    if (row.provider !== "self_hosted" && row.provider !== "external_linked") {
      results.push({ projectId: row.projectId, provider: row.provider, status: "skipped", detail: "레거시 provider(github/gitlab) - Gitea 사본 없음" });
      continue;
    }
    try {
      const newOrg = await ensureProjectOrgConfigured(row.projectId);
      const tasks: MigrateTask[] =
        row.provider === "self_hosted"
          ? [{ legacyRepoSlug: legacySlug(row.projectId), newRepoName: "repo" }]
          : [
              { legacyRepoSlug: legacyMirrorSlug(row.projectId), newRepoName: "mirror" },
              { legacyRepoSlug: legacyWorkSlug(row.projectId), newRepoName: "work" },
            ];

      const details: string[] = [];
      let anyFailed = false;
      let allAlreadyDone = true;
      for (const task of tasks) {
        const outcome = await migrateOneTask(newOrg, task);
        details.push(outcome.detail);
        if (!outcome.ok) anyFailed = true;
        if (!outcome.alreadyDone) allAlreadyDone = false;
      }

      if (!anyFailed && row.provider === "self_hosted") {
        const cloneUrl = await getCloneUrl(newOrg, "repo");
        if (cloneUrl) await db.projectGitRepo.update({ where: { projectId: row.projectId }, data: { repoUrl: cloneUrl } });
      }

      results.push({
        projectId: row.projectId,
        provider: row.provider,
        status: anyFailed ? "failed" : allAlreadyDone ? "already-migrated" : "migrated",
        detail: details.join("; "),
      });
    } catch (err) {
      results.push({ projectId: row.projectId, provider: row.provider, status: "failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  console.table(results);
  const failedCount = results.filter((r) => r.status === "failed").length;
  console.log(`총 ${results.length}건 - 실패 ${failedCount}건`);
  if (failedCount > 0) process.exitCode = 1;

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
