// 외부 GitHub/GitLab 저장소에 웹훅을 자동 등록한다(자격증명이 있고
// 권한이 충분할 때만 - 실패하면 호출부가 수동 설정 안내로 폴백한다).
// Gitea처럼 우리가 저장소를 만들지는 않는다 - 이미 존재하는 외부
// 저장소를 "연결"만 한다.

function ownerAndRepo(repoUrl: string): { host: string; ownerRepo: string } {
  const url = new URL(repoUrl);
  const ownerRepo = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  return { host: url.host, ownerRepo };
}

export async function registerWebhook(
  provider: "github" | "gitlab",
  repoUrl: string,
  token: string,
  targetUrl: string,
  secret: string,
): Promise<void> {
  if (provider === "github") return registerGithubWebhook(repoUrl, token, targetUrl, secret);
  return registerGitlabWebhook(repoUrl, token, targetUrl, secret);
}

// github.com만 지원(GitHub Enterprise는 API 베이스가 달라 이번 범위 밖).
async function registerGithubWebhook(repoUrl: string, token: string, targetUrl: string, secret: string): Promise<void> {
  const { ownerRepo } = ownerAndRepo(repoUrl);
  const res = await fetch(`https://api.github.com/repos/${ownerRepo}/hooks`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push"],
      config: { url: targetUrl, content_type: "json", secret },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub 웹훅 등록 실패: HTTP ${res.status} ${body}`);
  }
}

// gitUrl의 host를 그대로 API 베이스로 쓴다 - gitlab.com과 자체 호스팅
// GitLab 인스턴스 둘 다 커버.
async function registerGitlabWebhook(repoUrl: string, token: string, targetUrl: string, secret: string): Promise<void> {
  const { host, ownerRepo } = ownerAndRepo(repoUrl);
  const projectPath = encodeURIComponent(ownerRepo);
  const res = await fetch(`https://${host}/api/v4/projects/${projectPath}/hooks`, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl, push_events: true, token: secret }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitLab 웹훅 등록 실패: HTTP ${res.status} ${body}`);
  }
}
