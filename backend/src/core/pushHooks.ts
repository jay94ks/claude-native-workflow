import crypto from "node:crypto";
import { getDb } from "./db.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { syncSourceFilesForPush } from "./sourceIndex.js";
import { resolveProjectFromSlug } from "./gitRepos.js";
import { deleteRelationsForBranch } from "./codeRelations.js";

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

export interface ParsedDelete {
  branch: string;
  refType: "branch" | "tag";
  repoSlug: string;
}

/** Gitea의 delete 웹훅 페이로드 - GitHub 호환 형식과 동일하게 ref는
 * 이미 짧은 이름(예: "topic", "refs/heads/" 접두사 없음)으로 온다고
 * 알려져 있으나, normalizePush()와 동일하게 접두사가 붙어 와도
 * 안전하도록 그대로 벗겨낸다(실측 미확인 - 실제 브랜치 삭제로 재확인
 * 필요, 접두사가 없어도 replace는 no-op이라 안전). */
function normalizeDelete(json: Record<string, unknown>): ParsedDelete {
  const ref = String(json.ref ?? "").replace(/^refs\/(heads|tags)\//, "");
  const refType = String(json.ref_type ?? "branch") === "tag" ? "tag" : "branch";
  const repoSlug = String((json.repository as Record<string, unknown> | undefined)?.name ?? "");
  return { branch: ref, refType, repoSlug };
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

/** Gitea 시스템 웹훅 전용 - 서명만 검증하고 파싱하지 않는다(push/delete
 * 둘 다 같은 서명 방식이라 검증 로직을 공유하기 위해 분리). 검증
 * 통과 후 호출부가 `x-gitea-event` 헤더로 이벤트 종류를 판별해 알맞은
 * normalize*()를 부른다. */
function verifyGiteaSignature(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, secret: string): Record<string, unknown> {
  const sig = headerValue(headers["x-gitea-signature"]);
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!sig || !timingSafeEqualStr(sig, expected)) throw new Error("웹훅 서명이 올바르지 않습니다(Gitea)");
  return JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
}

export function classifyGiteaEvent(headers: Record<string, string | string[] | undefined>): "push" | "delete" | "unknown" {
  const kind = headerValue(headers["x-gitea-event"]);
  if (kind === "push") return "push";
  if (kind === "delete") return "delete";
  return "unknown";
}

/** Gitea 시스템 웹훅의 push 이벤트 파싱 - verifyAndParseWebhook(provider
 * 공용)과 별개로 둔 이유는 verifyAndParseDeleteWebhook()과 서명 검증을
 * 공유하기 위해서다. */
export function verifyAndParsePushWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secret: string,
): ParsedPush {
  return normalizePush(verifyGiteaSignature(headers, rawBody, secret));
}

export function verifyAndParseDeleteWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secret: string,
): ParsedDelete {
  return normalizeDelete(verifyGiteaSignature(headers, rawBody, secret));
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

/** triggerBranch를 리터럴 브랜치명 또는 glob 패턴으로 해석해 매칭한다 -
 * `*`가 없으면 지금까지처럼 정확 일치(#hook-branch-pattern 이전 동작과
 * 100% 동일), 있으면 그 자리를 세그먼트 안에서만(`/`를 안 넘는)
 * 와일드카드로 취급한다(`release/*`가 `release/1.0`엔 매칭되지만
 * `release/1.0/hotfix`엔 안 됨 - git 브랜치 프리픽스 관례에 맞춘
 * 직관적인 범위). 정규식 전체를 지원하지 않는 건 의도적 - glob 하나만
 * 지원해도 실제 요청 사례(`release/*`류)는 다 커버되고, 두 문법을
 * 동시에 지원하면 어느 쪽으로 해석해야 할지 구분하는 규칙이 따로
 * 필요해져 오히려 헷갈린다. */
function matchesBranchPattern(pattern: string, branch: string): boolean {
  if (!pattern.includes("*")) return pattern === branch;
  const escaped = pattern
    .split("*")
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`).test(branch);
}

/** 매칭되는 PushHookPrompt마다 PushHookQueueEntry를 하나씩 쌓는다.
 * 반환값은 실제로 쌓인 개수 - Phase 3 전까지는 PushHookPrompt를 만드는
 * CRUD가 없으므로 0이 정상이다. glob 패턴 매칭은 DB 쿼리로 표현할 수
 * 없어(프로젝트당 프롬프트 수가 적어 성능 문제 없음) 전체를 불러와
 * 애플리케이션에서 거른다. */
export async function recordPushEvent(projectId: string, parsed: ParsedPush): Promise<number> {
  const db = getDb();
  const prompts = await db.pushHookPrompt.findMany({ where: { projectId } });
  const matched = (prompts as { id: string; triggerBranch: string | null }[]).filter(
    (p) => p.triggerBranch === null || matchesBranchPattern(p.triggerBranch, parsed.branch),
  );
  for (const prompt of matched) {
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

  return matched.length;
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

export type GiteaSystemDeleteResult =
  | { status: "processed"; projectId: string; deletedRelations: number }
  | { status: "ignored"; reason: string };

/** 시스템 웹훅의 delete(브랜치/태그 삭제) 이벤트 전용 경로 -
 * handleGiteaSystemPush()와 같은 slug 판별 원칙. 태그 삭제는 코드
 * 관계도와 무관하므로 무시하고, 브랜치 삭제만 그 브랜치를 가리키던
 * 모든 설계자의 CodeRelation을 일괄 삭제한다(codeRelations.ts의
 * deleteRelationsForBranch() - 설계자별 소유 스코프의 유일한 의도적
 * 예외, 그 함수 docstring 참고). */
export async function handleGiteaSystemDelete(parsed: ParsedDelete): Promise<GiteaSystemDeleteResult> {
  if (parsed.refType !== "branch") return { status: "ignored", reason: "브랜치 삭제가 아님(태그)" };
  const resolved = resolveProjectFromSlug(parsed.repoSlug);
  if (!resolved) return { status: "ignored", reason: "관리 대상 저장소가 아님" };
  if (resolved.kind === "mirror") return { status: "ignored", reason: "미러 저장소의 브랜치 삭제는 무시함" };
  const deletedRelations = await deleteRelationsForBranch(resolved.projectId, parsed.branch);
  return { status: "processed", projectId: resolved.projectId, deletedRelations };
}
