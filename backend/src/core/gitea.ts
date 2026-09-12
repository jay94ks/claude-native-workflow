// Gitea REST API 얇은 래퍼. 저장소 생성/웹훅 등록/커밋 조회/파일 커밋만
// 다룬다 - 실제 clone/push는 설계자가 Gitea의 HTTP(S) git 프로토콜로
// 직접 한다(백엔드가 프록시하지 않음, SSH 키 관리 부담도 없앰).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOrCreateGiteaSystemWebhookSecret } from "./installConfig.js";
import { paginateInMemory, type Page } from "./pagination.js";

interface GiteaConfig {
  apiUrl: string;
  token: string;
  owner: string;
}

function config(): GiteaConfig {
  const apiUrl = process.env.GITEA_API_URL;
  const token = process.env.GITEA_API_TOKEN;
  const owner = process.env.GITEA_ADMIN_USERNAME;
  if (!apiUrl || !token || !owner) {
    throw new Error("GITEA_API_URL/GITEA_API_TOKEN/GITEA_ADMIN_USERNAME 환경변수가 필요합니다");
  }
  return { apiUrl, token, owner };
}

export function repoOwner(): string {
  return config().owner;
}

// 저장소는 관리자 개인 네임스페이스가 아니라 이 시스템이 만드는 Gitea
// 조직(organization) 네임스페이스 아래 만든다 - "소유자가 누구냐"라는
// 질문 자체를 없애고, 그 대신 저장소별 협업자 권한을 Member.role과
// 동기화하는 방식으로 접근을 표현한다(core/members.ts의
// syncCollaboratorGrant() 참고). 조직 이름은 새 환경변수 없이 고정
// 상수를 기본값으로 쓰되, 필요하면 GITEA_ORG_NAME으로 덮어쓸 수 있다.
const DEFAULT_ORG_LOGIN = "cnwk-projects";

export function orgLogin(): string {
  return process.env.GITEA_ORG_NAME || DEFAULT_ORG_LOGIN;
}

/** 서버 기동 시 호출(Gitea 미설정이면 조용히 스킵 - fail-soft) - 이
 * 시스템의 조직 네임스페이스가 아직 없으면 만든다(멱등 - GET으로 먼저
 * 존재를 확인). 시스템 웹훅/계정 마스터링보다 먼저 실행돼야 한다 -
 * 그 안에 만들어질 저장소들이 이 조직을 전제로 하므로. */
export async function ensureGiteaOrgConfigured(): Promise<void> {
  try {
    config();
  } catch {
    return;
  }
  try {
    const { apiUrl, token } = config();
    const org = orgLogin();
    const getRes = await fetch(`${apiUrl}/api/v1/orgs/${encodeURIComponent(org)}`, {
      headers: { Authorization: `token ${token}` },
    });
    if (getRes.ok) return;
    if (getRes.status !== 404) {
      const body = await getRes.text().catch(() => "");
      throw new Error(`Gitea API 오류: HTTP ${getRes.status} ${body}`);
    }
    await giteaFetch("/api/v1/orgs", {
      method: "POST",
      body: JSON.stringify({ username: org, visibility: "private" }),
    });
  } catch (err) {
    console.error("ensureGiteaOrgConfigured 실패:", err);
  }
}

async function giteaFetch(path: string, init?: RequestInit): Promise<Response> {
  const { apiUrl, token } = config();
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
  return res;
}

export interface CreatedRepo {
  cloneUrl: string;
  externalRepoId: string;
}

/** Gitea가 새 저장소를 만들 때 `allow_manual_merge`를 기본 false로
 * 두는 것을 실제 인스턴스로 확인(POST /orgs/{org}/repos의
 * CreateRepoOption 자체엔 이 필드가 없어 생성 시점에 못 켬 - PATCH로
 * 생성 직후 별도로 켜야 함). 이게 꺼져 있으면 요구사항 4번(자동 머지
 * 실패 시 수동 병합 완료 기록)의 `mergePullRequestManually()`가
 * "manually-merged is not allowed" 405로 항상 실패한다 - 실제로 이
 * 오류를 재현해서 발견함. */
async function enableManualMerge(slug: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}`, {
    method: "PATCH",
    body: JSON.stringify({ allow_manual_merge: true }),
  });
}

export async function createRepo(slug: string): Promise<CreatedRepo> {
  const res = await giteaFetch(`/api/v1/orgs/${orgLogin()}/repos`, {
    method: "POST",
    body: JSON.stringify({ name: slug, private: true, auto_init: true }),
  });
  const json = (await res.json()) as { clone_url: string; id: number };
  await enableManualMerge(slug);
  return { cloneUrl: json.clone_url, externalRepoId: String(json.id) };
}

/** Gitea 저장소 이름을 바꾼다(#git-unlink 전용 - 외부 연동 해제 시
 * `{slug}-work`이던 작업 저장소를 self_hosted 표준 slug(접미사 없음)
 * 로 바꿔, requireGiteaWorkingSlug()의 self_hosted 분기가 그대로
 * 맞아떨어지게 한다 - 그렇지 않으면 DB의 provider만 바뀌고 실제 Gitea
 * 저장소 이름은 여전히 "-work" 접미사라 이후 모든 git 조회/커밋이
 * 엉뚱한(존재하지 않는) slug를 찾아 404가 난다). */
export async function renameRepo(oldSlug: string, newSlug: string): Promise<CreatedRepo> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${oldSlug}`, {
    method: "PATCH",
    body: JSON.stringify({ name: newSlug }),
  });
  const json = (await res.json()) as { clone_url: string; id: number };
  return { cloneUrl: json.clone_url, externalRepoId: String(json.id) };
}

/** migrateRepo()가 clone 실패로 던진 뒤(특히 GitAuthRequiredError -
 * 자격증명 입력 후 재시도가 실제 사용 경로) 남은 빈 stub 저장소를
 * 지운다. 실측으로 발견: Gitea의 migrate API는 저장소 레코드를 먼저
 * 만들고 그다음 clone을 시도하므로, clone이 인증 실패로 죽으면 빈
 * 저장소만 남는다 - 이 상태로 같은 slug를 또 migrate하면 "저장소가
 * 이미 존재합니다"로 막혀서 자격증명을 새로 넣고 재시도해도 영원히
 * 실패한다(설계자 확인 필요 없이 명백한 버그 - deleteRepo로 정리해야
 * 재시도가 실제로 성립함). */
export async function deleteRepo(slug: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}`, { method: "DELETE" });
}

/** migrateRepo()가 "인증이 필요해서 실패"를 다른 실패와 구분해 던질 때
 * 쓴다 - 호출부(gitRepos.ts)가 이 타입만 잡아서 "자격증명 입력 후
 * 재시도" 흐름으로 안내할 수 있게. */
export class GitAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitAuthRequiredError";
  }
}

export interface MigrateOptions {
  mirror: boolean;
  authToken?: string;
  description?: string;
}

/** 외부 저장소를 Gitea로 가져온다 - mirror:false면 그 시점 스냅샷을
 * 독립된 일반 저장소로(완전 이주), mirror:true면 Gitea가 주기적으로
 * 원본에서 pull해 최신 상태를 유지하는 읽기 전용 사본으로(연동용 미러).
 * 실패가 인증 문제로 보이면 GitAuthRequiredError로 구분해 던진다 -
 * Gitea가 정확히 어떤 상태/본문으로 인증 실패를 알리는지는 실제
 * 인스턴스로 검증해 확정 예정(지금은 401/403과 본문의 인증 관련
 * 문구를 폭넓게 잡는다 - Phase 2에서 webhook/blame 응답 형식을 실제
 * 컨테이너로 확정했던 것과 같은 방식). */
export async function migrateRepo(slug: string, cloneAddr: string, opts: MigrateOptions): Promise<CreatedRepo> {
  const { apiUrl, token } = config();
  const res = await fetch(`${apiUrl}/api/v1/repos/migrate`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_name: slug,
      repo_owner: orgLogin(),
      clone_addr: cloneAddr,
      mirror: opts.mirror,
      private: true,
      auth_token: opts.authToken,
      description: opts.description,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403 || /auth|credential|unauthorized/i.test(body)) {
      throw new GitAuthRequiredError(`외부 저장소 인증이 필요합니다: HTTP ${res.status} ${body}`);
    }
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
  const json = (await res.json()) as { clone_url: string; id: number };
  // PR은 항상 work 저장소(mirror:false)에서만 생성/머지된다
  // (requireGiteaWorkingSlug 참고) - 읽기 전용 pull-mirror엔 PR 자체가
  // 없으므로 그쪽은 건드릴 필요 없음.
  if (!opts.mirror) await enableManualMerge(slug);
  return { cloneUrl: json.clone_url, externalRepoId: String(json.id) };
}

/** 미러 저장소의 pull 동기화를 큐에 넣는다(Gitea 내부 작업 큐가 처리 -
 * 이 호출 자체는 완료를 기다리지 않고 즉시 반환된다). 호출부가 실제
 * 완료 시점을 알려면 getMirrorUpdatedAt()으로 타임스탬프 변화를
 * 폴링해야 한다. */
export async function forceMirrorSync(slug: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/mirror-sync`, { method: "POST" });
}

/** 미러가 마지막으로 실제 동기화된 시각(ISO 문자열) - forceMirrorSync()
 * 트리거 전후로 이 값을 비교해 "이번 트리거로 인한 pull이 실제로
 * 끝났는지" 판단하는 데 쓴다(mirror-sync 자체가 비동기 큐잉이라 트리거
 * 직후 바로 비교하면 옛 상태를 읽을 수 있음). */
export async function getMirrorUpdatedAt(slug: string): Promise<string | null> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}`);
  const json = (await res.json()) as { mirror_updated?: string };
  return json.mirror_updated ?? null;
}

// ---------------------------------------------------------------- Push Mirror (외부 저장소 동기화/발행)
// pull-mirror(forceMirrorSync/getMirrorUpdatedAt)와 정반대 방향 - 이
// 저장소(work)의 커밋을 외부 저장소로 실제 push한다. Gitea 자체 기능을
// 그대로 위임한다(설계자 확정 - git 프로토콜/GitHub·GitLab 커밋 API를
// 직접 다루지 않음). **정확한 API 경로/응답 필드명은 실제 Gitea
// 인스턴스의 /api/swagger로 재확인 - 버전별로 조금씩 다를 수 있다.**

export interface PushMirrorStatus {
  remoteAddress: string;
  lastError: string | null;
  lastUpdate: string | null;
}

/** work 저장소에 push mirror를 등록한다(이미 있으면 Gitea가 중복
 * 에러를 던짐 - 호출부가 getPushMirrorStatus로 먼저 존재를 확인해야
 * 한다). username/token은 자격증명에서 복호화한 값을 그대로 전달. */
export async function configurePushMirror(
  slug: string,
  remoteAddress: string,
  username: string,
  token: string,
): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/push_mirrors`, {
    method: "POST",
    body: JSON.stringify({
      remote_address: remoteAddress,
      remote_username: username,
      remote_password: token,
      sync_on_commit: false,
    }),
  });
}

/** 등록된 push mirror의 즉시 동기화를 큐에 넣는다(pull-mirror의
 * forceMirrorSync와 마찬가지로 비동기 - 완료 여부는
 * getPushMirrorStatus()의 lastUpdate/lastError로 폴링해 확인). */
export async function triggerPushMirrorSync(slug: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/push_mirrors-sync`, { method: "POST" });
}

/** 등록된 push mirror 목록(이 시스템은 저장소당 하나만 등록하므로
 * 첫 번째만 본다) - lastError가 있으면 마지막 동기화가 실패한 것
 * (자격증명에 push 권한이 없는 경우 등), null이면 성공. */
export async function getPushMirrorStatus(slug: string): Promise<PushMirrorStatus | null> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/push_mirrors`);
  const json = (await res.json()) as { remote_address: string; last_error?: string; last_update?: string }[];
  if (json.length === 0) return null;
  const first = json[0];
  return {
    remoteAddress: first.remote_address,
    lastError: first.last_error?.trim() ? first.last_error : null,
    lastUpdate: first.last_update ?? null,
  };
}

export interface FullTreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
  /** 바이트 크기 - Gitea git trees API 응답에 blob마다 이미 포함돼
   * 있는 필드(내용을 안 받고도 크기 제한을 먼저 걸러낼 수 있음, 소스
   * 코드 색인 백필용). */
  size?: number;
}

/** 재귀 전체 blob 목록(path+sha) - listTree()(Contents API, 1단계씩만
 * 봄)로는 두 저장소 전체를 비교할 수 없어서 필요(동기화 상태 비교용).
 * 기본 브랜치의 최신 커밋(ref 생략 시 Gitea가 기본 브랜치로 해석)
 * 트리를 재귀 조회한다. */
export async function getFullTree(slug: string, ref = "HEAD"): Promise<FullTreeEntry[]> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/git/trees/${ref}?recursive=true`);
  const json = (await res.json()) as { tree: { path: string; sha: string; type: string; size?: number }[] };
  return json.tree
    .filter((e) => e.type === "blob")
    .map((e) => ({ path: e.path, sha: e.sha, type: "blob" as const, size: e.size }));
}

export interface SystemWebhook {
  id: number;
  config: { url: string };
  events: string[];
}

/** 인스턴스 전체 시스템 웹훅 목록 - 실제 Gitea 1.27.3 인스턴스로 검증해
 * 확정: `GET /admin/hooks`는 쿼리 파라미터 없이도 시스템 웹훅만
 * 돌려준다(스웨거 문서상 `type` 쿼리의 기본값이 "system"). */
export async function listSystemWebhooks(): Promise<SystemWebhook[]> {
  const res = await giteaFetch("/api/v1/admin/hooks");
  return (await res.json()) as SystemWebhook[];
}

/** 시스템 웹훅 등록(인스턴스의 모든 저장소 - 기존 저장소 포함 - 의 push
 * 이벤트를 받음). 실제 인스턴스로 검증해 확정한 함정: `is_system_webhook`
 * 은 요청 바디 최상위가 아니라 `config` 객체 안에 문자열 `"true"`로
 * 넣어야 한다 - 최상위에 두거나 아예 생략하면 서버가 조용히 "기본
 * 웹훅"(신규 생성되는 저장소에만 복사되고 기존 저장소에는 전혀 안
 * 걸리는 템플릿)으로 만들어버린다(에러 없이 성공 응답이 오므로 알아채기
 * 어려움 - go-gitea/gitea#23139에 기록된 것과 같은 종류의 API 혼동을
 * 이 인스턴스에서 직접 재현해 확인했다). */
export async function createSystemWebhook(targetUrl: string, secret: string): Promise<void> {
  await giteaFetch("/api/v1/admin/hooks", {
    method: "POST",
    body: JSON.stringify({
      type: "gitea",
      config: { url: targetUrl, content_type: "json", secret, is_system_webhook: "true" },
      // "delete"(브랜치/태그 삭제) - 브랜치 스코프 코드 관계도 정리
      // (core/codeRelations.ts의 deleteRelationsForBranch())에 필요.
      events: ["push", "delete"],
      active: true,
    }),
  });
}

/** 이미 등록된 시스템 웹훅의 events 목록을 갱신(PATCH) - 기존
 * ensureGiteaSystemWebhookConfigured()는 "URL이 이미 있으면 스킵"이라
 * "push"만 구독하던 예전 배포에 "delete"를 새로 추가해도 반영이 안 되는
 * 문제가 있었다. EditHookOption.events가 swagger에 문서화돼 있어(admin
 * hooks PATCH) 여기서 events만 갈아친다(다른 필드는 안 건드림). */
async function updateSystemWebhookEvents(hookId: number, events: string[]): Promise<void> {
  await giteaFetch(`/api/v1/admin/hooks/${hookId}`, {
    method: "PATCH",
    body: JSON.stringify({ events }),
  });
}

const SYSTEM_WEBHOOK_EVENTS = ["push", "delete"];

/** 서버 기동 시 호출(Gitea 미설정이면 조용히 스킵 -
 * ensureEmqxAuthConfigured()와 동일한 fail-soft 원칙) - 우리 URL을
 * 가리키는 시스템 웹훅이 아직 없으면 등록한다(멱등 - 재기동해도 중복
 * 등록 안 됨, `listSystemWebhooks()`로 기존 목록의 url을 먼저 확인).
 * 이미 있는데 events가 최신 목록(SYSTEM_WEBHOOK_EVENTS)을 다 포함하지
 * 않으면(예: "delete" 추가 전에 배포된 기존 웹훅) PATCH로 갱신한다. */
export async function ensureGiteaSystemWebhookConfigured(): Promise<void> {
  try {
    config();
  } catch {
    return;
  }
  const publicUrl = process.env.PUBLIC_BACKEND_URL;
  if (!publicUrl) return; // 웹훅 콜백 주소가 없으면 등록해도 무의미

  const targetUrl = `${publicUrl.replace(/\/$/, "")}/api/webhooks/gitea/system`;

  try {
    const secret = await getOrCreateGiteaSystemWebhookSecret();
    const existing = await listSystemWebhooks();
    const match = existing.find((h) => h.config.url === targetUrl);
    if (!match) {
      await createSystemWebhook(targetUrl, secret);
    } else if (!SYSTEM_WEBHOOK_EVENTS.every((e) => match.events.includes(e))) {
      await updateSystemWebhookEvents(match.id, SYSTEM_WEBHOOK_EVENTS);
    }
  } catch (err) {
    console.error("ensureGiteaSystemWebhookConfigured 실패:", err);
  }
}

export async function listCommits(slug: string, opts?: { ref?: string; limit?: number }): Promise<unknown[]> {
  const qs = new URLSearchParams();
  if (opts?.ref) qs.set("sha", opts.ref);
  qs.set("limit", String(opts?.limit ?? 50));
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/commits?${qs}`);
  return res.json() as Promise<unknown[]>;
}

export interface CommitPage {
  items: unknown[];
  hasMore: boolean;
}

/** 웹 변경 추적 화면 전용(요청 4번 페이지네이션) - Gitea 커밋 목록
 * API가 정확한 총 개수를 안정적으로 안 줘서(버전마다 다를 수 있음),
 * "다음 페이지에 실제로 항목이 있는가"만 별도로 가벼운 요청(limit=1)
 * 으로 확인하는 방식을 쓴다 - 헤더 유무에 기대지 않아 항상 정확하다. */
export async function listCommitsPaged(
  slug: string,
  opts: { ref?: string; page: number; pageSize: number },
): Promise<CommitPage> {
  const qs = new URLSearchParams();
  if (opts.ref) qs.set("sha", opts.ref);
  qs.set("limit", String(opts.pageSize));
  qs.set("page", String(opts.page));
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/commits?${qs}`);
  const items = (await res.json()) as unknown[];

  const nextQs = new URLSearchParams();
  if (opts.ref) nextQs.set("sha", opts.ref);
  nextQs.set("limit", "1");
  nextQs.set("page", String(opts.page + 1));
  const nextRes = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/commits?${nextQs}`);
  const nextItems = (await nextRes.json()) as unknown[];

  return { items, hasMore: nextItems.length > 0 };
}

export async function getCommit(slug: string, sha: string): Promise<unknown> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/git/commits/${sha}`);
  return res.json();
}

// /api/v1/repos/{owner}/{repo}/git/commits/{sha}.diff - 실제 Gitea
// 1.27 인스턴스에 대고 검증해서 확정한 경로("/{owner}/{repo}/commit/
// {sha}.diff" 웹 라우트는 404 - API 하위 경로가 맞다).
export async function getCommitDiff(slug: string, sha: string): Promise<string> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/git/commits/${sha}.diff`);
  return res.text();
}

// Gitea REST API에는 blame 엔드포인트가 없다(swagger.v1.json에 "blame"을
// 포함하는 경로가 전혀 없음 - 1.27 기준 직접 확인) - 웹 UI의 blame
// 페이지(HTML)도 이 배포 환경에서는 RepoAssignment 단계에서 404가 나서
// 토큰 인증으로는 믿고 쓸 수 없었다. 그래서 실제 조회를 시도하지 않고
// 알려진 플랫폼 제한을 즉시 알린다(엔드포인트가 있는 척 호출해서 애매한
// 404를 내는 것보다 명확하다).
export async function getBlame(_slug: string, _filepath: string, _ref?: string): Promise<never> {
  throw new Error(
    "Gitea REST API는 blame 조회를 지원하지 않습니다(알려진 플랫폼 제한 - git log/diff/show로 대신 변경 이력을 확인하세요)",
  );
}

async function getContentsRaw(slug: string, path: string, ref?: string): Promise<unknown> {
  const encodedPath = path ? path.split("/").map(encodeURIComponent).join("/") : "";
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/contents/${encodedPath}${qs}`);
  return res.json();
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

/** Gitea Contents API는 디렉터리면 배열, 파일이면 객체 하나를 돌려준다 -
 * 이 함수는 디렉터리 조회 전용(배열이 아니면 명확한 에러). path 빈
 * 문자열이면 루트. */
export async function listTree(slug: string, dirPath: string, ref?: string): Promise<TreeEntry[]> {
  const raw = await getContentsRaw(slug, dirPath, ref);
  if (!Array.isArray(raw)) {
    throw new Error(`${dirPath || "/"}는 디렉터리가 아닙니다`);
  }
  return (raw as { name: string; path: string; type: string }[]).map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type === "dir" ? "dir" : "file",
  }));
}

/** Gitea Contents API 자체가 page/limit 파라미터를 안 받는 단발성
 * 엔드포인트라(listCommitsPaged처럼 상류에 페이지를 위임할 수 없음),
 * 전체 목록을 한 번에 받아온 뒤 여기서 잘라 반환한다 - 디렉터리
 * 하나가 실제로 수백~수천 항목까지 가는 경우는 드물어 감내 가능한
 * 비용이라고 판단. */
export async function listTreePaged(slug: string, dirPath: string, ref: string | undefined, page: number, pageSize: number): Promise<Page<TreeEntry>> {
  const all = await listTree(slug, dirPath, ref);
  return paginateInMemory(all, page, pageSize);
}

export interface FileContent {
  path: string;
  content: string;
  sha: string;
}

export async function getFileContent(slug: string, filePath: string, ref?: string): Promise<FileContent> {
  const raw = await getContentsRaw(slug, filePath, ref);
  if (Array.isArray(raw)) {
    throw new Error(`${filePath}는 파일이 아니라 디렉터리입니다`);
  }
  const file = raw as { path: string; content: string; sha: string };
  return { path: file.path, content: Buffer.from(file.content, "base64").toString("utf-8"), sha: file.sha };
}

const RAW_CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "git-raw");

export interface RawFile {
  cachePath: string;
  sha: string;
  size: number;
}

/** 이미지/영상 미리보기·"원본 다운로드" 전용 - Gitea에서 받은 내용을
 * JSON+base64로 바로 감싸 응답하지 않고, blob sha를 파일명 삼아 로컬
 * 디스크 캐시(backend/.cache/git-raw/<sha>)에 디코드해 저장한 뒤 그
 * 파일 경로를 반환한다(호출부가 res.sendFile()로 서빙 - Content-Type/
 * ETag/Last-Modified/Range를 Express가 전부 알아서 처리). sha가 이미
 * 내용의 고유 식별자라 내용이 바뀌면 sha도 바뀌어 캐시가 자연히
 * 무효화되고, 같은 내용이면 프로젝트가 달라도 캐시가 재사용된다. */
export async function getFileRaw(slug: string, filePath: string, ref?: string): Promise<RawFile> {
  const raw = await getContentsRaw(slug, filePath, ref);
  if (Array.isArray(raw)) {
    throw new Error(`${filePath}는 파일이 아니라 디렉터리입니다`);
  }
  const file = raw as { sha: string; content: string };
  const cachePath = path.join(RAW_CACHE_DIR, file.sha);
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(RAW_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, Buffer.from(file.content, "base64"));
  }
  return { cachePath, sha: file.sha, size: fs.statSync(cachePath).size };
}

const RAW_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
};

export function mimeTypeForPath(filePath: string): string {
  const dotIdx = filePath.lastIndexOf(".");
  const ext = dotIdx < 0 ? "" : filePath.slice(dotIdx + 1).toLowerCase();
  return RAW_MIME_TYPES[ext] ?? "application/octet-stream";
}

/** 파일이 있으면 갱신, 없으면 생성 - 소스 에디터 저장 + CLAUDE.md/
 * SKILL.md 템플릿 배포에서 쓴다. `actingToken`이 있으면 그 값(호출한
 * 설계자 자신의 Gitea PAT - core/giteaAccounts.ts의
 * getGiteaAccessToken())으로 인증해 커밋이 그 설계자 신원으로
 * 귀속되게 한다 - 없으면(그 설계자가 아직 Gitea 토큰이 없는 과도기
 * 상태) 관리자 토큰으로 폴백한다(저장 자체를 막지 않기 위한 방어적
 * 처리 - 호출부가 이 경우 경고를 남긴다). */
export async function putFileContent(
  slug: string,
  filepath: string,
  content: string,
  message: string,
  actingToken?: string,
): Promise<void> {
  const { apiUrl, token: adminToken } = config();
  const authToken = actingToken || adminToken;
  const encodedPath = filepath.split("/").map(encodeURIComponent).join("/");
  const contentPath = `/api/v1/repos/${orgLogin()}/${slug}/contents/${encodedPath}`;

  let existingSha: string | undefined;
  const getRes = await fetch(`${apiUrl}${contentPath}`, { headers: { Authorization: `token ${authToken}` } });
  if (getRes.ok) {
    const json = (await getRes.json()) as { sha: string };
    existingSha = json.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`Gitea 파일 조회 실패: HTTP ${getRes.status}`);
  }

  const contentB64 = Buffer.from(content, "utf-8").toString("base64");
  const res = await fetch(`${apiUrl}${contentPath}`, {
    method: existingSha ? "PUT" : "POST",
    headers: { Authorization: `token ${authToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: contentB64, message, sha: existingSha }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
}

/** Gitea 사용자 계정 존재 여부 - 사용자 계정 마스터링(core/
 * giteaAccounts.ts)의 username 충돌 회피용. 실제 인스턴스로 검증해
 * 확정: `GET /users/:username`이 있으면 200, 없으면 404. */
export async function giteaUserExists(username: string): Promise<boolean> {
  const { apiUrl, token } = config();
  const res = await fetch(`${apiUrl}/api/v1/users/${encodeURIComponent(username)}`, {
    headers: { Authorization: `token ${token}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
  return true;
}

export interface CreatedGiteaUser {
  id: number;
  username: string;
}

/** Gitea 관리자 API로 새 사용자 계정을 만든다 - 이 시스템의 User 계정
 * 마스터링(core/giteaAccounts.ts) 전용. 이 계정의 비밀번호는 사람이
 * 로그인할 목적이 아니라 이 백엔드가 내부적으로만 쓰는 토큰이라
 * `must_change_password: false`로 만든다. */
export async function createGiteaUser(input: {
  username: string;
  email: string;
  password: string;
}): Promise<CreatedGiteaUser> {
  const res = await giteaFetch("/api/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: input.username,
      email: input.email,
      password: input.password,
      must_change_password: false,
      send_notify: false,
    }),
  });
  const json = (await res.json()) as { id: number; username: string };
  return { id: json.id, username: json.username };
}

/** 저장소 협업자 권한 부여/변경 - Member.role과 동기화하는 용도
 * (core/members.ts의 syncCollaboratorGrant()). 관리자 토큰으로 호출
 * (저장소가 속한 조직의 관리자 권한이 필요 - 협업자 본인 권한이 아님). */
export async function setRepoCollaborator(
  slug: string,
  username: string,
  permission: "read" | "write" | "admin",
): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/collaborators/${encodeURIComponent(username)}`, {
    method: "PUT",
    body: JSON.stringify({ permission }),
  });
}

export async function removeRepoCollaborator(slug: string, username: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/collaborators/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}

/** 그 설계자 본인의 Gitea 비밀번호로 Basic Auth해 PAT를 발급한다 -
 * 실제 인스턴스로 검증해 확정: `POST /users/{username}/tokens`는
 * 관리자 토큰이 아니라 그 계정 자신의 Basic Auth를 요구한다(giteaFetch
 * 를 못 씀 - 항상 관리자 토큰만 쓰므로 별도 raw fetch). 응답의 평문
 * 토큰 값은 `sha1` 필드(실측 확인 - `token`이 아님). `write:repository`
 * 스코프 하나면 repo 읽기/쓰기 둘 다 커버되는 것도 실측 확인(별도로
 * `read:repository`를 안 넣어도 됨). `write:issue`는 PR 워크플로우
 * 확장(설계자간 대화 - PR 댓글 작성)에서 실측으로 추가 확인: Gitea가
 * PR을 issue로 취급해 이 댓글 API를 issue 스코프로 게이팅하므로
 * repository 스코프만으론 403이 난다(직접 재현해 확인). 기존에 이미
 * 발급된 토큰은 이 스코프가 없으므로, PR 댓글을 쓰려는 설계자는
 * `docs git my-token`으로 재발급받아야 한다. */
export async function createUserAccessToken(username: string, password: string, tokenName: string): Promise<string> {
  const { apiUrl } = config();
  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  const res = await fetch(`${apiUrl}/api/v1/users/${encodeURIComponent(username)}/tokens`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: tokenName, scopes: ["write:repository", "write:issue"] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
  const json = (await res.json()) as { sha1: string };
  return json.sha1;
}

// ---------------------------------------------------------------- 브랜치 / Pull Request (저장소 관리 탭)
// Gitea REST API가 GitHub과 거의 동일한 PR 엔드포인트 모양을 제공한다
// (/branches, /pulls, /pulls/{index}/merge) - putFileContent()와 같은
// "actingToken이 있으면 그걸로, 없으면 관리자 토큰 폴백" 패턴을 PR
// 생성/머지에도 그대로 적용해 설계자 본인 명의로 남게 한다.

async function giteaFetchAs(path: string, actingToken: string | undefined, init?: RequestInit): Promise<Response> {
  const { apiUrl, token: adminToken } = config();
  const authToken = actingToken || adminToken;
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${authToken}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
  return res;
}

export interface BranchSummary {
  name: string;
  commitSha: string;
  lastCommitAt: string | null;
}

export async function listBranches(slug: string): Promise<BranchSummary[]> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/branches?limit=100`);
  const json = (await res.json()) as Array<{ name: string; commit: { id: string; timestamp?: string } }>;
  return json.map((b) => ({ name: b.name, commitSha: b.commit.id, lastCommitAt: b.commit.timestamp ?? null }));
}

export interface PullRequestSummary {
  index: number;
  title: string;
  body: string;
  state: string;
  authorUsername: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
  createdAt: string;
}

interface RawGiteaPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user?: { login: string } | null;
  head?: { ref: string } | null;
  base?: { ref: string } | null;
  merged?: boolean;
  created_at: string;
}

function toPullRequestSummary(pr: RawGiteaPullRequest): PullRequestSummary {
  return {
    index: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    state: pr.state,
    authorUsername: pr.user?.login ?? "?",
    headBranch: pr.head?.ref ?? "",
    baseBranch: pr.base?.ref ?? "",
    merged: !!pr.merged,
    createdAt: pr.created_at,
  };
}

export async function listPullRequests(slug: string, state?: "open" | "closed" | "all"): Promise<PullRequestSummary[]> {
  const qs = new URLSearchParams();
  qs.set("state", state ?? "all");
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/pulls?${qs}`);
  const json = (await res.json()) as RawGiteaPullRequest[];
  return json.map(toPullRequestSummary);
}

export async function getPullRequest(slug: string, index: number): Promise<PullRequestSummary> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/pulls/${index}`);
  return toPullRequestSummary((await res.json()) as RawGiteaPullRequest);
}

/** actingToken이 있으면 그 설계자 명의로 PR이 생성된다(없으면 관리자
 * 토큰 폴백 - putFileContent()와 같은 원칙). */
export async function createPullRequest(
  slug: string,
  input: { title: string; head: string; base: string; body?: string },
  actingToken?: string,
): Promise<PullRequestSummary> {
  const res = await giteaFetchAs(`/api/v1/repos/${orgLogin()}/${slug}/pulls`, actingToken, {
    method: "POST",
    body: JSON.stringify({ title: input.title, head: input.head, base: input.base, body: input.body ?? "" }),
  });
  return toPullRequestSummary((await res.json()) as RawGiteaPullRequest);
}

/** 실질적인 머지는 프로젝트 소유자만(설계자 요청 - 호출부인
 * server.ts가 requireProjectRole("owner")로 이중 방어). Gitea의 merge
 * 옵션 필드명은 대문자로 시작하는 `Do`(swagger MergePullRequestOption
 * 기준) - 기본 merge 전략만 지원(squash/rebase는 이번 범위 밖). */
export async function mergePullRequest(slug: string, index: number, actingToken?: string): Promise<void> {
  await giteaFetchAs(`/api/v1/repos/${orgLogin()}/${slug}/pulls/${index}/merge`, actingToken, {
    method: "POST",
    body: JSON.stringify({ Do: "merge" }),
  });
}

// ---------------------------------------------------------------- PR 워크플로우 확장(댓글/타임라인/커밋/상태전이/수동병합)
// 기존 mergePullRequest()가 실측 확인한 필드명은 대문자 `Do`이지만,
// swagger.v1.json에 문서화된 필드명은 소문자다(state/do/merge_commit_id) -
// 신규 함수는 문서 그대로 소문자로 구현한다(기존 mergePullRequest는
// 이미 동작 중이므로 건드리지 않음). 아래 함수들은 실제 Gitea
// 인스턴스로 스모크 테스트해 필드명을 재확인한다.

export interface PullRequestComment {
  id: number;
  body: string;
  authorUsername: string;
  createdAt: string;
  updatedAt: string;
}

interface RawGiteaComment {
  id: number;
  body: string;
  user?: { login: string } | null;
  created_at: string;
  updated_at: string;
}

function toComment(c: RawGiteaComment): PullRequestComment {
  return { id: c.id, body: c.body, authorUsername: c.user?.login ?? "?", createdAt: c.created_at, updatedAt: c.updated_at };
}

/** PR도 issue 취급하는 Gitea API 관례 그대로 - 설계자간 대화(Markdown). */
export async function listPullRequestComments(slug: string, index: number): Promise<PullRequestComment[]> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/issues/${index}/comments`);
  const json = (await res.json()) as RawGiteaComment[];
  return json.map(toComment);
}

export async function addPullRequestComment(slug: string, index: number, body: string, actingToken?: string): Promise<PullRequestComment> {
  const res = await giteaFetchAs(`/api/v1/repos/${orgLogin()}/${slug}/issues/${index}/comments`, actingToken, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  return toComment((await res.json()) as RawGiteaComment);
}

export interface PullRequestTimelineEntry {
  id: number;
  type: string; // "comment" | "close" | "merge_pull" | "reopen" | "commit_ref" | "label" | ...
  body: string;
  authorUsername: string | null;
  createdAt: string;
}

interface RawGiteaTimelineEntry {
  id: number;
  type: string;
  body?: string | null;
  user?: { login: string } | null;
  created_at: string;
}

/** "PR이 닫힐 때까지의 전체 히스토리" - Gitea의 issue 타임라인(코멘트/
 * 상태전이/머지/브랜치 참조 등이 type으로 구분된 하나의 이벤트 피드)을
 * 그대로 매핑한다. */
export async function listPullRequestTimeline(slug: string, index: number): Promise<PullRequestTimelineEntry[]> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/issues/${index}/timeline`);
  const json = (await res.json()) as RawGiteaTimelineEntry[];
  return json.map((e) => ({ id: e.id, type: e.type, body: e.body ?? "", authorUsername: e.user?.login ?? null, createdAt: e.created_at }));
}

export interface PullRequestCommit {
  sha: string;
  message: string;
  authorName: string;
  authoredAt: string;
}

interface RawGiteaPullCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
}

export async function listPullRequestCommits(slug: string, index: number): Promise<PullRequestCommit[]> {
  const res = await giteaFetch(`/api/v1/repos/${orgLogin()}/${slug}/pulls/${index}/commits`);
  const json = (await res.json()) as RawGiteaPullCommit[];
  return json.map((c) => ({ sha: c.sha, message: c.commit.message, authorName: c.commit.author.name, authoredAt: c.commit.author.date }));
}

/** Close/Reopen 공용 - EditPullRequestOption.state("open"|"closed"). */
export async function setPullRequestState(slug: string, index: number, state: "open" | "closed", actingToken?: string): Promise<PullRequestSummary> {
  const res = await giteaFetchAs(`/api/v1/repos/${orgLogin()}/${slug}/pulls/${index}`, actingToken, {
    method: "PATCH",
    body: JSON.stringify({ state }),
  });
  return toPullRequestSummary((await res.json()) as RawGiteaPullRequest);
}

/** 자동 머지가 실패했을 때 designer(또는 AI)가 로컬에서 직접 충돌을
 * 해결해 push한 뒤, 그 결과를 Gitea에 "수동으로 병합됨"으로 기록시킨다
 * (MergePullRequestOption.do:"manually-merged" - swagger 문서화된 값,
 * 요구사항 4번의 핵심 메커니즘). */
export async function mergePullRequestManually(slug: string, index: number, mergeCommitId: string, actingToken?: string): Promise<void> {
  await giteaFetchAs(`/api/v1/repos/${orgLogin()}/${slug}/pulls/${index}/merge`, actingToken, {
    method: "POST",
    body: JSON.stringify({ Do: "manually-merged", merge_commit_id: mergeCommitId }),
  });
}

/** 재발급(회전) 전 기존 토큰을 지운다 - 실측 확인: 삭제도 그 계정
 * 자신의 Basic Auth로 된다(관리자 sudo 불필요). 이미 없어졌거나
 * 이름이 안 맞아 404가 나도 무시(재발급 흐름을 막지 않기 위해). */
export async function deleteUserAccessToken(username: string, password: string, tokenName: string): Promise<void> {
  const { apiUrl } = config();
  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  const res = await fetch(`${apiUrl}/api/v1/users/${encodeURIComponent(username)}/tokens/${encodeURIComponent(tokenName)}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
}
