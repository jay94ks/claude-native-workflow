// 배치 8b(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// git 트리/파일 조회·저장(Phase 5(2/3) - 소스 코드 브라우저용).
// server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import { requireGiteaWorkingRef } from "../../core/gitRepos.js";
import * as gitea from "../../core/gitea.js";
import { normalizeGitPath } from "../../core/gitPath.js";
import { syncSourceFileOnSave, syncSourceFileOnDelete } from "../../core/sourceIndex.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy, assertDefined } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.get(
  "/api/projects/:projectId/git/tree",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const dirPath = req.query.path ? normalizeGitPath(req.query.path as string) : "";
    res.json(await gitea.listTree(req.params.projectId, target, dirPath, req.query.ref as string | undefined));
  }),
);

router.get(
  "/api/projects/:projectId/git/tree/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const dirPath = req.query.path ? normalizeGitPath(req.query.path as string) : "";
    res.json(
      await gitea.listTreePaged(
        req.params.projectId,
        target,
        dirPath,
        req.query.ref as string | undefined,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

router.get(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filePath, "path 쿼리 파라미터가 필요합니다");
    res.json(await gitea.getFileContent(req.params.projectId, target, filePath, req.query.ref as string | undefined));
  }),
);

// 문서와 같은 이유(#document-partial-read-grep-diff)로 소스 코드
// 파일도 부분 읽기/검색 지원 - 큰 파일을 매번 전체로 안 올려도 됨.
router.get(
  "/api/projects/:projectId/git/file/lines",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filePath, "path 쿼리 파라미터가 필요합니다");
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json(await gitea.readSourceFileLines(req.params.projectId, target, filePath, req.query.ref as string | undefined, offset, limit));
  }),
);

router.get(
  "/api/projects/:projectId/git/file/grep",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filePath, "path 쿼리 파라미터가 필요합니다");
    const { q } = req.query as { q?: string };
    assertTruthy(q, "q가 필요합니다");
    const matches = await gitea.grepSourceFile(req.params.projectId, target, filePath, q, req.query.ref as string | undefined, {
      caseInsensitive: req.query.caseInsensitive === "true",
      context: req.query.context !== undefined ? Number(req.query.context) : undefined,
    });
    res.json(matches);
  }),
);

// 소스 파일 선택기(엔티티 선택기 kind="sourceFile")용 - 재귀 전체 파일
// 목록(기존 getFullTree()는 지금까지 git 동기화 제안 기능이 내부적으로만
// 썼다, 새 라우트만 추가).
router.get(
  "/api/projects/:projectId/git/tree/all",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.getFullTree(req.params.projectId, target));
  }),
);

router.put(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filePath, "path 쿼리 파라미터가 필요합니다");
    const { content, message } = req.body as { content?: string; message?: string };
    assertDefined(content, "content가 필요합니다");
    // 커밋이 실제로 이 요청을 보낸 설계자 신원으로 귀속되도록 userId를
    // 넘긴다 - putFileContent()가 그 설계자의 git 저작자 신원을 구해
    // 커밋하고(없으면 관리자 신원으로 폴백).
    await gitea.putFileContent(req.params.projectId, target, filePath, content, message || `docs: update ${filePath}`, req.userId);
    await syncSourceFileOnSave(req.params.projectId, filePath, content);
    res.json({ ok: true });
  }),
);

router.delete(
  "/api/projects/:projectId/git/file",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filePath, "path 쿼리 파라미터가 필요합니다");
    const { message } = (req.body ?? {}) as { message?: string };
    // put과 같은 원칙 - 커밋이 요청을 보낸 설계자 신원으로 귀속되도록
    // userId를 넘긴다(없으면 관리자 신원으로 폴백).
    await gitea.deleteFileContent(req.params.projectId, target, filePath, message || `docs: delete ${filePath}`, req.userId);
    await syncSourceFileOnDelete(req.params.projectId, filePath);
    res.json({ ok: true });
  }),
);

// 여러 파일을 한 번에 조회 - #git-cache-and-staging. path를 쉼표로
// 구분해 받는다(질의/코드 관계도의 --refs와 같은 CLI 관례).
router.get(
  "/api/projects/:projectId/git/files",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const pathsParam = req.query.paths as string | undefined;
    assertTruthy(pathsParam, "paths 쿼리 파라미터가 필요합니다(쉼표로 구분)");
    const paths = pathsParam.split(",").map((p) => normalizeGitPath(p.trim())).filter(Boolean);
    const contentByPath = await gitea.getFileContentsBatch(req.params.projectId, target, paths);
    res.json({
      files: paths.map((path) => {
        const found = contentByPath.get(path);
        return { path, content: found?.content ?? null, sha: found?.sha ?? null };
      }),
    });
  }),
);

// 이미지/영상 미리보기 + "원본 다운로드" 전용 - blob sha 기반 로컬
// 캐시에서 raw 바이트를 그대로 서빙한다(JSON+base64 아님). 인증
// 미들웨어를 거치므로 <img src>/<video src>로 직접 못 부른다 - 프런트는
// 인증된 fetch()로 이 라우트를 호출해 Blob을 받고 object URL을 만든다.
// (원래 server.ts에서는 "스테이징" 섹션 안에 물리적으로 위치했지만
// 실제로는 파일 서빙 관심사라 이 파일로 옮겼다 - 배치 8 재검토.)
router.get(
  "/api/projects/:projectId/git/file/raw",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const filePath = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(filePath, "path 쿼리 파라미터가 필요합니다");
    const raw = await gitea.getFileRaw(req.params.projectId, target, filePath, req.query.ref as string | undefined);
    res.type(gitea.mimeTypeForPath(filePath));
    res.sendFile(raw.cachePath);
  }),
);

export default router;
