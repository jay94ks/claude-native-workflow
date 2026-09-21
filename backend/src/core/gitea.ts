// docs/plan-gitea-provisioning.md - Gitea REST API 얇은 래퍼. v2의
// core/gitea.ts를 조사해 계승할 부분만 가져왔다 - v2는 Gitea 자체가 주
// 저장소라 "설계자별 그림자 계정" 같은 게 필요했지만, v3는 로컬 es-git이
// 주 저장소이고 Gitea는 옵션 push-mirror 대상일 뿐이라 그 부분은 대상이
// 아니다. "프로젝트당 org 하나, 그 안에 저장소 하나"라는 네이밍 패턴과
// 멱등 org 생성/저장소 생성 API 호출 형태만 계승한다.

export class GiteaError extends Error {}

interface GiteaConfig {
  apiUrl: string;
  token: string;
}

/**
 * GITEA_URL/GITEA_API_TOKEN 둘 다 없으면 이 기능 자체가 미설정 - v2의
 * giteaConfigured()와 동일한 판단(다만 v3는 이 값이 없으면 그냥 "연결"
 * 액션 자체를 명확히 거부한다 - project.create처럼 조용히 넘어가면 안
 * 되는, 설계자가 명시적으로 요청한 동작이므로).
 *
 * **주의**: 이 값은 그 Gitea 인스턴스의 `ROOT_URL` 설정과 문자열 그대로
 * (호스트명 표기까지) 일치해야 한다 - Gitea가 `clone_url`을 항상
 * `ROOT_URL` 그대로 돌려주고(`ensureRepoConfigured` 참고), `gitRepo.ts`의
 * `pushCredentialFor()`가 그 저장된 clone_url의 origin과 이 값의 origin을
 * 문자열로 비교해 일치할 때만 토큰을 자동으로 얹기 때문이다 - "localhost"
 * vs "127.0.0.1"처럼 사람 눈엔 같아 보여도 다른 origin이면 조용히 자격
 * 증명 없이 push를 시도해 401로 실패한다(실기동 중 실제로 겪은 문제).
 */
export function config(): GiteaConfig | null {
  const apiUrl = process.env.GITEA_URL;
  const token = process.env.GITEA_API_TOKEN;
  if (!apiUrl || !token) return null;
  return { apiUrl: apiUrl.replace(/\/+$/, ""), token };
}

async function giteaFetch(path: string, init?: RequestInit): Promise<Response> {
  const cfg = config();
  if (!cfg) throw new GiteaError("GITEA_URL/GITEA_API_TOKEN이 설정돼 있지 않습니다.");
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GiteaError(`Gitea API 오류: HTTP ${res.status} ${body}`);
  }
  return res;
}

/** 그 org가 없으면 만든다(GET 후 404일 때만 POST - 이미 있으면 그대로 재사용,
 * v2의 ensureOrgConfigured() 계승). */
export async function ensureOrgConfigured(org: string): Promise<void> {
  const cfg = config();
  if (!cfg) throw new GiteaError("GITEA_URL/GITEA_API_TOKEN이 설정돼 있지 않습니다.");

  const getRes = await fetch(`${cfg.apiUrl}/api/v1/orgs/${encodeURIComponent(org)}`, {
    headers: { Authorization: `token ${cfg.token}` },
  });
  if (getRes.ok) return;
  if (getRes.status !== 404) {
    const body = await getRes.text().catch(() => "");
    throw new GiteaError(`Gitea API 오류: HTTP ${getRes.status} ${body}`);
  }
  await giteaFetch("/api/v1/orgs", { method: "POST", body: JSON.stringify({ username: org, visibility: "private" }) });
}

export interface CreatedRepo {
  cloneUrl: string;
}

/**
 * 그 org 안에 저장소를 멱등하게 만든다(이미 있으면 기존 clone_url을
 * 그대로 반환). `auto_init: false`가 중요하다 - true면 Gitea가 README로
 * 기본 브랜치를 미리 커밋해버려서 로컬 es-git 저장소의 첫 push와
 * 브랜치가 갈라진다(v2가 실제로 재현해 기록해둔 버그, 그대로 계승해서
 * 피한다).
 */
export async function ensureRepoConfigured(org: string, repo: string): Promise<CreatedRepo> {
  const cfg = config();
  if (!cfg) throw new GiteaError("GITEA_URL/GITEA_API_TOKEN이 설정돼 있지 않습니다.");

  const getRes = await fetch(`${cfg.apiUrl}/api/v1/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`, {
    headers: { Authorization: `token ${cfg.token}` },
  });
  if (getRes.ok) {
    const json = (await getRes.json()) as { clone_url: string };
    return { cloneUrl: json.clone_url };
  }
  if (getRes.status !== 404) {
    const body = await getRes.text().catch(() => "");
    throw new GiteaError(`Gitea API 오류: HTTP ${getRes.status} ${body}`);
  }

  const res = await giteaFetch(`/api/v1/orgs/${encodeURIComponent(org)}/repos`, {
    method: "POST",
    body: JSON.stringify({ name: repo, private: true, auto_init: false }),
  });
  const json = (await res.json()) as { clone_url: string };
  return { cloneUrl: json.clone_url };
}

/**
 * docs/plan-gitea-provisioning.md 판단해두는 것(후속 처리) - 프로젝트
 * 파기(`project.destroy`) 시 그 프로젝트의 Gitea org도 같이 정리한다
 * (v2의 `deleteOrg()`와 동일하게 fail-soft - 이미 프로젝트/문서 삭제가
 * 끝난 뒤 마지막 정리 단계라 이 호출 하나가 실패해도 파기 자체를
 * 막으면 안 된다). Gitea는 저장소가 남아있는 org의 삭제 자체를 거부
 * 하므로(실기동으로 확인함 - "user still has ownership of repositories")
 * org 안의 저장소를 전부 먼저 지운 뒤 org를 지운다. Gitea 미설정이거나
 * 애초에 그 org가 없었으면(연결한 적 없는 프로젝트) 조용히 넘어간다.
 */
export async function deleteOrgIfExists(org: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  try {
    const getRes = await fetch(`${cfg.apiUrl}/api/v1/orgs/${encodeURIComponent(org)}`, {
      headers: { Authorization: `token ${cfg.token}` },
    });
    if (!getRes.ok) return; // 없거나(404) 조회 자체가 실패 - 어느 쪽이든 정리할 게 없다고 보고 넘어간다

    const reposRes = await giteaFetch(`/api/v1/orgs/${encodeURIComponent(org)}/repos`);
    const repos = (await reposRes.json()) as { name: string }[];
    for (const repo of repos) {
      await giteaFetch(`/api/v1/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}`, { method: "DELETE" });
    }
    await giteaFetch(`/api/v1/orgs/${encodeURIComponent(org)}`, { method: "DELETE" });
  } catch (err) {
    console.warn(`[gitea] org "${org}" 정리 실패(무시하고 계속 진행):`, (err as Error).message);
  }
}

// Gitea org 사용자명 규칙(영문/숫자/-/_만, 특정 예약어 제외)에 맞춰 정리한다 -
// 프로젝트 내부 id(cuid)를 그대로 써서 DB 컬럼 없이도 항상 같은 org
// 이름을 재계산할 수 있게 한다(v2의 "org 이름은 projectId의 순수 함수" 계승).
export function orgForProject(projectId: string): string {
  return `proj-${projectId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export const CANONICAL_REPO_NAME = "repo";
