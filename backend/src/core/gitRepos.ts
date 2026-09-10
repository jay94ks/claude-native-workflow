import crypto from "node:crypto";
import { getDb } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { assertProjectExists } from "./projects.js";
import * as gitea from "./gitea.js";
import { registerWebhook } from "./externalGit.js";

export interface ProjectGitRepoInfo {
  projectId: string;
  provider: string;
  repoUrl: string;
  externalRepoId: string | null;
  gitCredentialId: string | null;
}

interface ProjectGitRepoRow {
  projectId: string;
  provider: string;
  repoUrl: string;
  externalRepoId: string | null;
  gitCredentialId: string | null;
  webhookSecretEncrypted: Buffer | null;
}

function toInfo(row: ProjectGitRepoRow): ProjectGitRepoInfo {
  return {
    projectId: row.projectId,
    provider: row.provider,
    repoUrl: row.repoUrl,
    externalRepoId: row.externalRepoId,
    gitCredentialId: row.gitCredentialId,
  };
}

/** 프로젝트별로 고유하고 Gitea repo 이름 제약(영문/숫자/-/_/.)에 맞는
 * slug - cuid는 이미 그 조건을 만족하므로 그대로 접두사만 붙여 쓴다. */
export function slugForProject(projectId: string): string {
  return `project-${projectId}`;
}

// PUBLIC_BACKEND_URL이 없으면(로컬 개발 등, 외부에서 닿을 수 있는 주소가
// 아직 없을 때) null을 반환 - 호출부가 웹훅 등록을 건너뛰고 나머지
// (저장소 생성/연결)는 정상 진행한다(realtimePublish와 같은 fail-soft
// 원칙 - 웹훅은 부가 기능이지 저장소 연결의 필수 조건이 아니다).
function webhookTargetUrl(provider: string, projectId: string): string | null {
  const base = process.env.PUBLIC_BACKEND_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/webhooks/${provider}/${projectId}`;
}

export async function linkSelfHostedRepo(projectId: string): Promise<ProjectGitRepoInfo & { webhookRegistered: boolean }> {
  await assertProjectExists(projectId);
  const db = getDb();
  const existing = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (existing) throw new Error("이미 git 저장소가 연결된 프로젝트입니다");

  const slug = slugForProject(projectId);
  const { cloneUrl, externalRepoId } = await gitea.createRepo(slug);
  const secret = crypto.randomBytes(24).toString("hex");

  const targetUrl = webhookTargetUrl("gitea", projectId);
  let webhookRegistered = false;
  if (targetUrl) {
    await gitea.createWebhook(slug, targetUrl, secret);
    webhookRegistered = true;
  }

  const row = await db.projectGitRepo.create({
    data: {
      projectId,
      provider: "self_hosted",
      repoUrl: cloneUrl,
      externalRepoId,
      webhookSecretEncrypted: encryptSecret(secret),
    },
  });
  return { ...toInfo(row), webhookRegistered };
}

export interface LinkExternalResult extends ProjectGitRepoInfo {
  webhookAutoRegistered: boolean;
  manualWebhookInstructions?: { url: string; secret: string };
}

export async function linkExternalRepo(
  projectId: string,
  provider: "github" | "gitlab",
  repoUrl: string,
  gitCredentialId?: string,
): Promise<LinkExternalResult> {
  await assertProjectExists(projectId);
  const db = getDb();
  const existing = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (existing) throw new Error("이미 git 저장소가 연결된 프로젝트입니다");

  const secret = crypto.randomBytes(24).toString("hex");
  const targetUrl = webhookTargetUrl(provider, projectId);

  let autoRegistered = false;
  if (targetUrl && gitCredentialId) {
    const cred = await db.gitCredential.findUnique({ where: { id: gitCredentialId } });
    if (cred) {
      const token = decryptSecret(cred.encryptedPayload);
      try {
        await registerWebhook(provider, repoUrl, token, targetUrl, secret);
        autoRegistered = true;
      } catch {
        // 자동 등록 실패는 링크 자체를 막지 않는다 - 수동 안내로 폴백.
        autoRegistered = false;
      }
    }
  }

  const row = await db.projectGitRepo.create({
    data: {
      projectId,
      provider,
      repoUrl,
      gitCredentialId: gitCredentialId ?? null,
      webhookSecretEncrypted: encryptSecret(secret),
    },
  });

  return {
    ...toInfo(row),
    webhookAutoRegistered: autoRegistered,
    ...(!autoRegistered && targetUrl ? { manualWebhookInstructions: { url: targetUrl, secret } } : {}),
  };
}

export async function getProjectGitRepo(projectId: string): Promise<ProjectGitRepoInfo | null> {
  const db = getDb();
  const row = await db.projectGitRepo.findUnique({ where: { projectId } });
  return row ? toInfo(row) : null;
}

export async function getWebhookSecret(projectId: string): Promise<string | null> {
  const db = getDb();
  const row = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (!row?.webhookSecretEncrypted) return null;
  return decryptSecret(row.webhookSecretEncrypted);
}

/** git log/diff/blame/show, template deploy 공통 가드 - 저장소가 없거나
 * 외부 호스팅이면 명확한 이유와 함께 즉시 실패시킨다(조용히 빈 결과를
 * 주지 않음). */
export async function requireSelfHostedRepo(projectId: string): Promise<ProjectGitRepoInfo> {
  const repo = await getProjectGitRepo(projectId);
  if (!repo) {
    throw new Error("먼저 git 저장소를 연결하세요(POST .../git/link 또는 .../git/link-external)");
  }
  if (repo.provider !== "self_hosted") {
    throw new Error("외부 호스팅 저장소는 아직 git 이력 조회를 지원하지 않습니다(자체 호스팅만 지원)");
  }
  return repo;
}
