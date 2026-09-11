// Gitea REST API 얇은 래퍼. 저장소 생성/웹훅 등록/커밋 조회/파일 커밋만
// 다룬다 - 실제 clone/push는 설계자가 Gitea의 HTTP(S) git 프로토콜로
// 직접 한다(백엔드가 프록시하지 않음, SSH 키 관리 부담도 없앰).

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

export async function createRepo(slug: string): Promise<CreatedRepo> {
  const res = await giteaFetch("/api/v1/user/repos", {
    method: "POST",
    body: JSON.stringify({ name: slug, private: true, auto_init: true }),
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
  const { owner } = config();
  await giteaFetch(`/api/v1/repos/${owner}/${slug}`, { method: "DELETE" });
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
  return { cloneUrl: json.clone_url, externalRepoId: String(json.id) };
}

/** 미러 저장소의 pull 동기화를 큐에 넣는다(Gitea 내부 작업 큐가 처리 -
 * 이 호출 자체는 완료를 기다리지 않고 즉시 반환된다). 호출부가 실제
 * 완료 시점을 알려면 getMirrorUpdatedAt()으로 타임스탬프 변화를
 * 폴링해야 한다. */
export async function forceMirrorSync(slug: string): Promise<void> {
  const { owner } = config();
  await giteaFetch(`/api/v1/repos/${owner}/${slug}/mirror-sync`, { method: "POST" });
}

/** 미러가 마지막으로 실제 동기화된 시각(ISO 문자열) - forceMirrorSync()
 * 트리거 전후로 이 값을 비교해 "이번 트리거로 인한 pull이 실제로
 * 끝났는지" 판단하는 데 쓴다(mirror-sync 자체가 비동기 큐잉이라 트리거
 * 직후 바로 비교하면 옛 상태를 읽을 수 있음). */
export async function getMirrorUpdatedAt(slug: string): Promise<string | null> {
  const { owner } = config();
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}`);
  const json = (await res.json()) as { mirror_updated?: string };
  return json.mirror_updated ?? null;
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
  const { owner } = config();
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}/git/trees/${ref}?recursive=true`);
  const json = (await res.json()) as { tree: { path: string; sha: string; type: string; size?: number }[] };
  return json.tree
    .filter((e) => e.type === "blob")
    .map((e) => ({ path: e.path, sha: e.sha, type: "blob" as const, size: e.size }));
}

export async function createWebhook(slug: string, targetUrl: string, secret: string): Promise<void> {
  const { owner } = config();
  await giteaFetch(`/api/v1/repos/${owner}/${slug}/hooks`, {
    method: "POST",
    body: JSON.stringify({
      type: "gitea",
      config: { url: targetUrl, content_type: "json", secret },
      events: ["push"],
      active: true,
    }),
  });
}

export async function listCommits(slug: string, opts?: { ref?: string; limit?: number }): Promise<unknown[]> {
  const { owner } = config();
  const qs = new URLSearchParams();
  if (opts?.ref) qs.set("sha", opts.ref);
  qs.set("limit", String(opts?.limit ?? 50));
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}/commits?${qs}`);
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
  const { owner } = config();
  const qs = new URLSearchParams();
  if (opts.ref) qs.set("sha", opts.ref);
  qs.set("limit", String(opts.pageSize));
  qs.set("page", String(opts.page));
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}/commits?${qs}`);
  const items = (await res.json()) as unknown[];

  const nextQs = new URLSearchParams();
  if (opts.ref) nextQs.set("sha", opts.ref);
  nextQs.set("limit", "1");
  nextQs.set("page", String(opts.page + 1));
  const nextRes = await giteaFetch(`/api/v1/repos/${owner}/${slug}/commits?${nextQs}`);
  const nextItems = (await nextRes.json()) as unknown[];

  return { items, hasMore: nextItems.length > 0 };
}

export async function getCommit(slug: string, sha: string): Promise<unknown> {
  const { owner } = config();
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}/git/commits/${sha}`);
  return res.json();
}

// /api/v1/repos/{owner}/{repo}/git/commits/{sha}.diff - 실제 Gitea
// 1.27 인스턴스에 대고 검증해서 확정한 경로("/{owner}/{repo}/commit/
// {sha}.diff" 웹 라우트는 404 - API 하위 경로가 맞다).
export async function getCommitDiff(slug: string, sha: string): Promise<string> {
  const { owner } = config();
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}/git/commits/${sha}.diff`);
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
  const { owner } = config();
  const encodedPath = path ? path.split("/").map(encodeURIComponent).join("/") : "";
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await giteaFetch(`/api/v1/repos/${owner}/${slug}/contents/${encodedPath}${qs}`);
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

/** 파일이 있으면 갱신, 없으면 생성 - CLAUDE.md/SKILL.md 템플릿 배포용. */
export async function putFileContent(slug: string, filepath: string, content: string, message: string): Promise<void> {
  const { apiUrl, token, owner } = config();
  const encodedPath = filepath.split("/").map(encodeURIComponent).join("/");
  const contentPath = `/api/v1/repos/${owner}/${slug}/contents/${encodedPath}`;

  let existingSha: string | undefined;
  const getRes = await fetch(`${apiUrl}${contentPath}`, { headers: { Authorization: `token ${token}` } });
  if (getRes.ok) {
    const json = (await getRes.json()) as { sha: string };
    existingSha = json.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`Gitea 파일 조회 실패: HTTP ${getRes.status}`);
  }

  const contentB64 = Buffer.from(content, "utf-8").toString("base64");
  await giteaFetch(contentPath, {
    method: existingSha ? "PUT" : "POST",
    body: JSON.stringify({ content: contentB64, message, sha: existingSha }),
  });
}
