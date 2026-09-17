// 배치 8d(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 동기화 제안(미러 vs 작업 저장소) + 외부 저장소 동기화(발행, Push
// Mirror) - 둘 다 작아서 한 파일로 합쳤다. server.ts에서 그대로 잘라낸
// 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import {
  requestGitSyncStatus,
  getCachedGitSyncStatus,
  getGitSyncProposal,
  publishToExternalRepo,
  getPendingPublishQueueEntry,
  completePublishQueueEntry,
} from "../../core/gitRepos.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// Gitea의 mirror-sync 트리거가 비동기 큐잉이라(즉시 완료 안 됨) 요청/조회를
// 분리한다 - POST가 트리거(즉시 "예정됨"/"이미 예정됨" 반환), GET이
// 그 결과를 폴링(pending/ready/none). 이미 진행 중일 때 POST를 또
// 호출해도 새로 트리거하지 않는다(requestGitSyncStatus 내부에서 처리).

// git 저장소 기능은 프로젝트 관리자(owner)만 쓸 수 있다(설계자 확정 -
// viewer/editor는 아예 손댈 수 없음).
router.post(
  "/api/projects/:projectId/git/sync-status",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await requestGitSyncStatus(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/git/sync-status",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getCachedGitSyncStatus(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/git/sync-proposal",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getGitSyncProposal(req.params.projectId));
  }),
);

// 실제 push를 시도해 그 결과로 성공/실패(권한 부족·충돌 등)를
// 판단한다 - owner 전용(git 저장소 기능 전체와 동일). 실패하면
// AI 대기열에 올라가고, 완료 보고 전까지는 GET .../publish-queue가
// pending 항목을 계속 돌려줘 "동기화" 버튼을 비활성 상태로 유지시킨다.

router.post(
  "/api/projects/:projectId/git/publish",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { gitCredentialId } = req.body as { gitCredentialId?: string };
    assertTruthy(gitCredentialId, "gitCredentialId가 필요합니다");
    res.json(await publishToExternalRepo(req.params.projectId, gitCredentialId));
  }),
);

router.get(
  "/api/projects/:projectId/git/publish-queue",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    res.json(await getPendingPublishQueueEntry(req.params.projectId));
  }),
);

router.post(
  "/api/projects/:projectId/git/publish-queue/:id/done",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    await completePublishQueueEntry(req.params.id, req.params.projectId);
    res.json({ ok: true });
  }),
);

export default router;
