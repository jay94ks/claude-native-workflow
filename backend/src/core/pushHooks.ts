import crypto from "node:crypto";
import { getDb } from "./db.js";

// 웹훅 수신 인프라(Phase 2 범위) - PushHookPrompt를 만들고 매칭 규칙을
// 관리하는 CRUD/CLI는 아직 없다(Phase 3 몫). 지금은 이미 존재하는
// PushHookPrompt 행과 매칭해 PushHookQueueEntry를 쌓는 배관만 검증한다 -
// Phase 3 전까지는 매칭 0건이 정상이다.

export interface ParsedPush {
  branch: string;
  headSha: string;
  commits: { sha: string; message: string }[];
}

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Gitea/GitHub/GitLab의 push 웹훅 페이로드는 거의 같은 모양이다 -
// ref/after(또는 checkout_sha)/commits[].id(또는 .sha)/message로 정규화.
function normalizePush(json: Record<string, unknown>): ParsedPush {
  const ref = String(json.ref ?? "");
  const branch = ref.replace(/^refs\/heads\//, "");
  const headSha = String((json.after as string | undefined) ?? (json.checkout_sha as string | undefined) ?? "");
  const rawCommits = Array.isArray(json.commits) ? (json.commits as Record<string, unknown>[]) : [];
  const commits = rawCommits.map((c) => ({
    sha: String((c.id as string | undefined) ?? (c.sha as string | undefined) ?? ""),
    message: String(c.message ?? ""),
  }));
  return { branch, headSha, commits };
}

export function verifyAndParseWebhook(
  provider: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secret: string,
): ParsedPush {
  const json = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;

  if (provider === "gitea") {
    const sig = headerValue(headers["x-gitea-signature"]);
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!sig || !timingSafeEqualStr(sig, expected)) throw new Error("웹훅 서명이 올바르지 않습니다(Gitea)");
    return normalizePush(json);
  }
  if (provider === "github") {
    const sigHeader = headerValue(headers["x-hub-signature-256"]);
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!sigHeader || !timingSafeEqualStr(sigHeader, expected)) throw new Error("웹훅 서명이 올바르지 않습니다(GitHub)");
    return normalizePush(json);
  }
  if (provider === "gitlab") {
    const token = headerValue(headers["x-gitlab-token"]);
    if (!token || !timingSafeEqualStr(token, secret)) throw new Error("웹훅 토큰이 올바르지 않습니다(GitLab)");
    return normalizePush(json);
  }
  throw new Error(`알 수 없는 provider: ${provider}`);
}

/** 매칭되는 PushHookPrompt마다 PushHookQueueEntry를 하나씩 쌓는다.
 * 반환값은 실제로 쌓인 개수 - Phase 3 전까지는 PushHookPrompt를 만드는
 * CRUD가 없으므로 0이 정상이다. */
export async function recordPushEvent(projectId: string, parsed: ParsedPush): Promise<number> {
  const db = getDb();
  const prompts = await db.pushHookPrompt.findMany({
    where: { projectId, OR: [{ triggerBranch: null }, { triggerBranch: parsed.branch }] },
  });
  for (const prompt of prompts as { id: string }[]) {
    await db.pushHookQueueEntry.create({
      data: { pushHookPromptId: prompt.id, commitSha: parsed.headSha, status: "pending" },
    });
  }
  return prompts.length;
}
