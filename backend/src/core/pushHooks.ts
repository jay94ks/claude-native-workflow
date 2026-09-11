import crypto from "node:crypto";
import { getDb } from "./db.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { syncSourceFilesForPush } from "./sourceIndex.js";
import { resolveProjectFromSlug } from "./gitRepos.js";

// 웹훅 수신 인프라(Phase 2 범위) - PushHookPrompt를 만들고 매칭 규칙을
// 관리하는 CRUD/CLI는 아직 없다(Phase 3 몫). 지금은 이미 존재하는
// PushHookPrompt 행과 매칭해 PushHookQueueEntry를 쌓는 배관만 검증한다 -
// Phase 3 전까지는 매칭 0건이 정상이다.

export interface ParsedPush {
  branch: string;
  headSha: string;
  commits: { sha: string; message: string; added: string[]; modified: string[]; removed: string[] }[];
  /** payload의 `repository.name`(Gitea repo slug) - 시스템 웹훅 경로
   * (handleGiteaSystemPush())가 이 값으로 어느 프로젝트의 push인지
   * 판별한다. 프로젝트별 웹훅 경로(기존 /api/webhooks/:provider/
   * :projectId)는 URL이 이미 projectId를 주므로 이 필드를 안 쓴다. */
  repoSlug: string;
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

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// Gitea/GitHub/GitLab의 push 웹훅 페이로드는 거의 같은 모양이다 -
// ref/after(또는 checkout_sha)/commits[].id(또는 .sha)/message로 정규화.
// commits[].added/modified/removed(파일 경로 목록)도 Gitea/GitHub 페이로드에
// 이미 포함돼 있어 새 API 호출 없이 소스 코드 색인 증분 동기화에 그대로
// 쓴다(core/sourceIndex.ts) - GitLab은 이 필드가 없을 수 있지만, 이
// 시스템에서 브라우징 가능한 git 콘텐츠는 항상 Gitea가 호스팅하는
// 저장소(자체 호스팅 또는 외부 연동의 "작업 저장소")뿐이라 웹훅은 항상
// Gitea 발신이라 문제 없다.
function normalizePush(json: Record<string, unknown>): ParsedPush {
  const ref = String(json.ref ?? "");
  const branch = ref.replace(/^refs\/heads\//, "");
  const headSha = String((json.after as string | undefined) ?? (json.checkout_sha as string | undefined) ?? "");
  const rawCommits = Array.isArray(json.commits) ? (json.commits as Record<string, unknown>[]) : [];
  const commits = rawCommits.map((c) => ({
    sha: String((c.id as string | undefined) ?? (c.sha as string | undefined) ?? ""),
    message: String(c.message ?? ""),
    added: stringArray(c.added),
    modified: stringArray(c.modified),
    removed: stringArray(c.removed),
  }));
  const repoSlug = String((json.repository as Record<string, unknown> | undefined)?.name ?? "");
  return { branch, headSha, commits, repoSlug };
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
  // 변경 추적 뷰(Phase 5 3/3)의 git 로그 섹션이 새로고침 없이 갱신되도록,
  // 매칭 여부와 무관하게 push가 들어올 때마다 발행한다(문서/코멘트와 같은
  // write-through 원칙 - "project" entity는 ChangeEvent 타입에 이미 있었지만
  // 지금까지 아무도 안 썼다).
  const event: ChangeEvent = { entity: "project", action: "update", id: projectId, at: new Date().toISOString() };
  await realtimePublish(projectChangesTopic(projectId), event);

  // 소스 코드 검색 인덱스 증분 동기화 - 웹훅 응답을 붙잡지 않도록
  // 기다리지 않고 실행(실패해도 syncSourceFilesForPush 내부에서 로그만
  // 남기고 조용히 끝남).
  void syncSourceFilesForPush(projectId, parsed);

  return prompts.length;
}

export type GiteaSystemPushResult =
  | { status: "processed"; projectId: string; queued: number }
  | { status: "ignored"; reason: string };

/** 시스템 웹훅(인스턴스 전체를 커버하는 단일 웹훅) 전용 경로 - payload의
 * repoSlug만으로 어느 프로젝트의 어떤 종류(self_hosted/work/mirror)
 * 저장소인지 DB 조회 없이 판별한다(core/gitRepos.ts의
 * resolveProjectFromSlug()). 미러 저장소의 push는 Gitea 자신의 주기적
 * pull 결과일 뿐 설계자가 뭔가를 바꿨다는 신호가 아니므로 무시한다.
 * 이 앱이 관리하지 않는 slug(수동으로 만든 저장소 등)도 조용히
 * 무시한다 - 시스템 웹훅은 인스턴스의 모든 저장소 이벤트를 받으므로
 * 이건 에러가 아니라 정상적으로 걸러야 할 이벤트일 뿐이다. */
export async function handleGiteaSystemPush(parsed: ParsedPush): Promise<GiteaSystemPushResult> {
  const resolved = resolveProjectFromSlug(parsed.repoSlug);
  if (!resolved) return { status: "ignored", reason: "관리 대상 저장소가 아님" };
  if (resolved.kind === "mirror") return { status: "ignored", reason: "미러 저장소 push는 무시함" };
  const queued = await recordPushEvent(resolved.projectId, parsed);
  return { status: "processed", projectId: resolved.projectId, queued };
}
