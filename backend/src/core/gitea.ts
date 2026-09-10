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
