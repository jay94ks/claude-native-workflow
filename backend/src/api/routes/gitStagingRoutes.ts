// 배치 8c(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// git 스테이징(add/status/rm/restore/commit) - #git-cache-and-staging.
// server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. file/raw
// 라우트는 물리적으로 이 섹션 안에 있었지만 파일 서빙 관심사라
// gitFileRoutes.ts로 옮겼다(배치 8 재검토).
import { Router } from "express";
import { requireGiteaWorkingRef } from "../../core/gitRepos.js";
import * as gitea from "../../core/gitea.js";
import * as gitStaging from "../../core/gitStaging.js";
import { normalizeGitPath } from "../../core/gitPath.js";
import { syncSourceFilesForCommit } from "../../core/sourceIndex.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy, assertDefined, assertNonEmpty } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/git/staging/add",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path: rawPath, content } = req.body as { path?: string; content?: string };
    assertTruthy(rawPath, "path가 필요합니다");
    assertDefined(content, "content가 필요합니다");
    res.json(await gitStaging.stageUpsert(req.params.projectId, normalizeGitPath(rawPath), content, req.userId));
  }),
);

router.post(
  "/api/projects/:projectId/git/staging/rm",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path: rawPath } = req.body as { path?: string };
    assertTruthy(rawPath, "path가 필요합니다");
    res.json(await gitStaging.stageDelete(req.params.projectId, normalizeGitPath(rawPath), req.userId));
  }),
);

// 파일마다 add/rm을 한 건씩 반복 호출하면(설계자 지적 - "docs git add가
// 갑자기 느려졌다"의 실제 원인은 파일 수만큼 CLI 프로세스+HTTP 왕복이
// 누적된 것) 여러 파일을 한 번에 스테이징한다 - #git-staging-bulk.
router.post(
  "/api/projects/:projectId/git/staging/add-bulk",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { items } = req.body as { items?: { path?: string; content?: string }[] };
    assertNonEmpty(items, "items가 필요합니다");
    for (const item of items) {
      assertTruthy(item.path, "items의 각 항목에 path가 필요합니다");
      assertDefined(item.content, "items의 각 항목에 content가 필요합니다");
      item.path = normalizeGitPath(item.path);
    }
    res.json(await gitStaging.bulkStageUpsert(req.params.projectId, items as { path: string; content: string }[], req.userId));
  }),
);

router.post(
  "/api/projects/:projectId/git/staging/rm-bulk",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { paths } = req.body as { paths?: string[] };
    assertNonEmpty(paths, "paths가 필요합니다");
    res.json(await gitStaging.bulkStageDelete(req.params.projectId, paths.map(normalizeGitPath), req.userId));
  }),
);

router.get(
  "/api/projects/:projectId/git/staging/status",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await gitStaging.getStatus(req.params.projectId));
  }),
);

router.post(
  "/api/projects/:projectId/git/staging/restore",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path: rawPath } = req.body as { path?: string };
    assertTruthy(rawPath, "path가 필요합니다");
    await gitStaging.restoreStaged(req.params.projectId, normalizeGitPath(rawPath));
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/git/staging/commit",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { message } = req.body as { message?: string };
    assertTruthy(message, "message가 필요합니다");
    const result = await gitStaging.commitStaged(req.params.projectId, message, req.userId);
    if (result.status === "committed" && result.paths.length > 0) {
      // 커밋 반영분의 검색 인덱스도 최신화(put/delete 라우트와 동일한
      // write-through) - 한 번에 배치 조회 + 한 번의 벌크 upsert/delete로
      // 반영(파일마다 개별 호출하면 Meilisearch 라운드트립이 그만큼
      // 늘어나 커밋이 느려짐 - 설계자 피드백으로 발견, syncSourceFilesForCommit).
      const target = await requireGiteaWorkingRef(req.params.projectId);
      const contentByPath = await gitea.getFileContentsBatch(req.params.projectId, target, result.paths);
      await syncSourceFilesForCommit(
        req.params.projectId,
        result.paths.map((path) => ({ path, content: contentByPath.get(path)?.content ?? null })),
      );
    }
    res.json(result);
  }),
);

export default router;
