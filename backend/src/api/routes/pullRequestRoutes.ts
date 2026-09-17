// 배치 8e(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 저장소 관리 탭(브랜치/Pull Request) + PR 상세 페이지(메시지/커밋/
// 대화/진행내역 + Reject/Close/Reopen/수동병합) - 서로 밀접해 한
// 파일로 합쳤다. server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import { requireGiteaWorkingRef } from "../../core/gitRepos.js";
import { getGiteaAccessToken } from "../../core/giteaAccounts.js";
import * as gitea from "../../core/gitea.js";
import {
  getPullRequestDetail,
  listPullRequestsForProject,
  mergePull,
  mergePullManually,
  rejectPull,
  closePull,
  reopenPull,
  listMessagesForPullRequest,
} from "../../core/pullRequests.js";
import { paginateInMemory } from "../../core/pagination.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { asyncRoute, resolveMessageOrigin } from "../shared.js";

const router = Router();

// "워크트리 리스트"는 이 아키텍처(프로젝트당 공유 Gitea work 저장소
// 하나, 로컬 다중 clone 없음)에 문자 그대로는 존재할 수 없어 "브랜치
// 목록 + 브랜치별 소스 열람"으로 재해석(설계자 확인 전제) - git/tree,
// git/log, git/file이 이미 받던 ref 쿼리 파라미터를 프론트의 브랜치
// 선택 UI가 실제로 채워 보내면 그대로 동작한다(새 조회 라우트 불필요).

router.get(
  "/api/projects/:projectId/git/branches",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listBranches(target));
  }),
);

// 목록은 항상 최신순(요구사항 7) - listPullRequestsForProject가
// createdAt desc로 확정 정렬하고 PullRequestMeta(disposition)도 병합해
// 반환한다. Gitea Contents API처럼 page 파라미터를 안정적으로 받지
// 않는 상류 특성상(listTreePaged와 동일 이유) 전체를 받아온 뒤 여기서
// 자른다 - /page 하위 경로는 저장소 관리 탭의 5개+더보기(요구사항 3)와
// 별도 PullRequestListView의 완전한 페이지네이션 둘 다에 쓴다.
router.get(
  "/api/projects/:projectId/git/pulls",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const state = req.query.state as "open" | "closed" | "all" | undefined;
    res.json(await listPullRequestsForProject(req.params.projectId, state));
  }),
);

router.get(
  "/api/projects/:projectId/git/pulls/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const state = req.query.state as "open" | "closed" | "all" | undefined;
    const all = await listPullRequestsForProject(req.params.projectId, state);
    res.json(paginateInMemory(all, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

router.get(
  "/api/projects/:projectId/git/pulls/:index",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await getPullRequestDetail(req.params.projectId, Number(req.params.index)));
  }),
);

router.post(
  "/api/projects/:projectId/git/pulls",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const { title, head, base, body } = req.body as { title?: string; head?: string; base?: string; body?: string };
    if (!title || !head || !base) {
      res.status(400).json({ error: "title/head/base가 필요합니다" });
      return;
    }
    // PR이 이 요청을 보낸 설계자 신원으로 귀속되도록 - putFileContent()와
    // 같은 원칙(없으면 관리자 토큰 폴백).
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    res.json(await gitea.createPullRequest(target, { title, head, base, body }, actingToken));
  }),
);

// 실질적인 머지는 프로젝트 소유자만(설계자 요청 핵심 제약) -
// requireProjectRole("owner")가 git 저장소 기능 전반과 동일한 수준으로
// 강제한다(PR 생성은 editor 이상 가능하지만 머지는 owner만).
router.post(
  "/api/projects/:projectId/git/pulls/:index/merge",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await mergePull(req.params.projectId, Number(req.params.index), req.userId!, resolveMessageOrigin(req), actingToken);
    res.json({ ok: true });
  }),
);

// PR 상세 페이지 - requireProjectRole("owner")가 머지/수동병합에만(기존
// 확정 - "머지는 소유자만"), 나머지 액션(거부/닫기/재오픈/댓글 작성)은
// PR 생성과 같은 급(editor 이상)으로 뒀다 - 되돌릴 수 있는 동작이고
// 저장소 히스토리를 바꾸지 않기 때문. 조회는 전부 viewer 이상.

router.get(
  "/api/projects/:projectId/git/pulls/:index/commits",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listPullRequestCommits(target, Number(req.params.index)));
  }),
);

router.get(
  "/api/projects/:projectId/git/pulls/:index/comments",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listPullRequestComments(target, Number(req.params.index)));
  }),
);

router.post(
  "/api/projects/:projectId/git/pulls/:index/comments",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    const { body } = req.body as { body?: string };
    if (!body?.trim()) { res.status(400).json({ error: "body가 필요합니다" }); return; }
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    res.json(await gitea.addPullRequestComment(target, Number(req.params.index), body.trim(), actingToken));
  }),
);

router.get(
  "/api/projects/:projectId/git/pulls/:index/timeline",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const target = await requireGiteaWorkingRef(req.params.projectId);
    res.json(await gitea.listPullRequestTimeline(target, Number(req.params.index)));
  }),
);

router.get(
  "/api/projects/:projectId/git/pulls/:index/messages",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMessagesForPullRequest(req.params.projectId, Number(req.params.index)));
  }),
);

router.post(
  "/api/projects/:projectId/git/pulls/:index/merge-manually",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { mergeCommitId } = req.body as { mergeCommitId?: string };
    if (!mergeCommitId?.trim()) { res.status(400).json({ error: "mergeCommitId가 필요합니다" }); return; }
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await mergePullManually(req.params.projectId, Number(req.params.index), mergeCommitId.trim(), req.userId!, resolveMessageOrigin(req), actingToken);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/git/pulls/:index/reject",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await rejectPull(req.params.projectId, Number(req.params.index), req.userId!, resolveMessageOrigin(req), actingToken);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/git/pulls/:index/close",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await closePull(req.params.projectId, Number(req.params.index), req.userId!, resolveMessageOrigin(req), actingToken);
    res.json({ ok: true });
  }),
);

router.post(
  "/api/projects/:projectId/git/pulls/:index/reopen",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const actingToken = (await getGiteaAccessToken(req.userId!)) ?? undefined;
    await reopenPull(req.params.projectId, Number(req.params.index), req.userId!, resolveMessageOrigin(req), actingToken);
    res.json({ ok: true });
  }),
);

export default router;
