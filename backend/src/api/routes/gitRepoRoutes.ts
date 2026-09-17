// 배치 8a(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// git 저장소 연결 + 이력 조회(Phase 2). server.ts에서 그대로 잘라낸
// 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import {
  linkSelfHostedRepo,
  linkExternalAsPrimary,
  promoteToExternal,
  unlinkExternalRepo,
  getProjectGitRepo,
  getWebhookSetupInstructions,
  requireGiteaWorkingRef,
  GitAuthRequiredError,
} from "../../core/gitRepos.js";
import * as gitea from "../../core/gitea.js";
import { normalizeGitPath } from "../../core/gitPath.js";
import { backfillProjectSourceIndex } from "../../core/sourceIndex.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// importFrom.repoUrl이 인증을 요구해 실패하면(비공개 저장소인데 자격증명
// 없음/틀림) 일반 400이 아니라 422 + git_auth_required로 응답한다 -
// 프런트가 그 자리에서 자격증명 입력 폼을 띄우고 저장 후 재시도할 수
// 있게(설계자 확인 - "인증이 필요한 외부 저장소" 흐름). hostPattern은
// 입력받은 URL의 host를 그대로 - 자격증명 입력 폼의 host 필드를 미리
// 채우는 데 씀. 401이 아니라 422를 쓰는 이유 - frontend/src/api/
// client.ts의 callWithRefresh()가 모든 401을 "액세스 토큰 만료"로
// 해석해 리프레시 토큰 갱신을 시도한다(그 자체는 무해하게 성공하고
// 재시도해도 이 라우트는 또 같은 이유로 실패하지만, 만약 그 순간
// 리프레시 토큰마저 만료돼 있으면 설계자의 로그인 세션 자체가
// 로그아웃되는 무관한 부작용이 생길 수 있다 - 이 라우트의 401은
// "설계자 세션" 문제가 전혀 아니므로 그 인터셉터와 충돌하지 않는
// 상태 코드를 쓴다).
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

router.post(
  "/api/projects/:projectId/git/link",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { importFrom } = req.body as { importFrom?: { repoUrl?: string; gitCredentialId?: string } };
    try {
      const result = await linkSelfHostedRepo(
        req.params.projectId,
        importFrom?.repoUrl ? { repoUrl: importFrom.repoUrl, gitCredentialId: importFrom.gitCredentialId } : undefined,
      );
      void backfillProjectSourceIndex(req.params.projectId);
      res.json(result);
    } catch (err) {
      if (err instanceof GitAuthRequiredError) {
        res.status(422).json({ error: "git_auth_required", hostPattern: importFrom?.repoUrl ? hostOf(importFrom.repoUrl) : undefined });
        return;
      }
      throw err;
    }
  }),
);

router.post(
  "/api/projects/:projectId/git/link-external",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { provider, repoUrl, gitCredentialId } = req.body as {
      provider?: string;
      repoUrl?: string;
      gitCredentialId?: string;
    };
    if (provider !== "github" && provider !== "gitlab") {
      res.status(400).json({ error: "provider는 github|gitlab이어야 합니다" });
      return;
    }
    assertTruthy(repoUrl, "repoUrl이 필요합니다");
    try {
      const result = await linkExternalAsPrimary(req.params.projectId, provider, repoUrl, gitCredentialId);
      void backfillProjectSourceIndex(req.params.projectId);
      res.json(result);
    } catch (err) {
      if (err instanceof GitAuthRequiredError) {
        res.status(422).json({ error: "git_auth_required", hostPattern: hostOf(repoUrl) });
        return;
      }
      throw err;
    }
  }),
);

router.post(
  "/api/projects/:projectId/git/promote-to-external",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { provider, repoUrl, gitCredentialId } = req.body as {
      provider?: string;
      repoUrl?: string;
      gitCredentialId?: string;
    };
    if (provider !== "github" && provider !== "gitlab") {
      res.status(400).json({ error: "provider는 github|gitlab이어야 합니다" });
      return;
    }
    assertTruthy(repoUrl, "repoUrl이 필요합니다");
    assertTruthy(gitCredentialId, "gitCredentialId가 필요합니다");
    try {
      const result = await promoteToExternal(req.params.projectId, provider, repoUrl, gitCredentialId);
      void backfillProjectSourceIndex(req.params.projectId);
      res.json(result);
    } catch (err) {
      if (err instanceof GitAuthRequiredError) {
        res.status(422).json({ error: "git_auth_required", hostPattern: hostOf(repoUrl) });
        return;
      }
      throw err;
    }
  }),
);

router.get(
  "/api/projects/:projectId/git/repo",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const repo = await getProjectGitRepo(req.params.projectId);
    if (!repo) { res.status(404).json({ error: "연결된 git 저장소가 없습니다" }); return; }
    res.json(repo);
  }),
);

// "웹훅 수동 설정 안내" 카드를 새로고침 후에도(또는 접었다 폈다 할
// 때마다) 다시 보여줄 수 있도록 URL/secret을 다시 조회하는 전용
// 라우트 - git 저장소 관리 기능 전반과 같은 원칙으로 owner 전용
// (secret이 섞여 있어 GET .../git/repo의 viewer 공개 범위엔 안 둠).
router.get(
  "/api/projects/:projectId/git/webhook-instructions",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getWebhookSetupInstructions(req.params.projectId));
  }),
);

// 외부 연동(link-external)의 권위 저장소 관계만 끊는다 - 자체 호스팅
// 저장소는 프로젝트 삭제 없이는 해제할 수 없다(설계자 확정,
// #git-unlink). 응답은 전환 후 상태(provider:"self_hosted")를 그대로
// 돌려줘 프런트가 재조회 없이 화면을 갱신할 수 있게 한다.
router.delete(
  "/api/projects/:projectId/git/repo",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await unlinkExternalRepo(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/git/log",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    res.json(await gitea.listCommits(target, { ref }));
  }),
);

// 웹 변경 추적 화면 전용 페이지네이션(요청 4번) - CLI/MCP가 쓰는 위
// 배열 응답 라우트는 그대로 둔다.
router.get(
  "/api/projects/:projectId/git/log/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const ref = req.query.ref as string | undefined;
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await gitea.listCommitsPaged(target, { ref, page, pageSize }));
  }),
);

router.get(
  "/api/projects/:projectId/git/diff/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const diff = await gitea.getCommitDiff(target, req.params.sha);
    res.type("text/plain").send(diff);
  }),
);

// 브랜치/커밋 이름은 "/"를 포함할 수 있어(예: feature/x) 경로
// 파라미터로 못 받는다 - 쿼리 파라미터로 받는다(#git-path-separator와
// 별개 이유, 그쪽은 파일 경로 얘기).
router.get(
  "/api/projects/:projectId/git/compare",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const { base, head } = req.query as { base?: string; head?: string };
    if (!base || !head) { res.status(400).json({ error: "base/head가 필요합니다" }); return; }
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const diff = await gitea.compareDiff(target, base, head);
    res.type("text/plain").send(diff);
  }),
);

router.get(
  "/api/projects/:projectId/git/blame",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filepath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filepath, "path 쿼리 파라미터가 필요합니다");
    res.json(await gitea.getBlame(target, filepath, req.query.ref as string | undefined));
  }),
);

router.get(
  "/api/projects/:projectId/git/show/:sha",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.getCommit(target, req.params.sha));
  }),
);

export default router;
