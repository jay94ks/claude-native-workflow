// 배치 2a(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 사용자 도메인 전부: 내 프로필(auth/me)/관리자 전용 사용자 관리/
// 검색 엔진 장애 대응 큐/설치 전체 사용 통계/공개 사용자 목록·프로필.
// server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
//
// **주의(#58 배치 작업 중 실측으로 발견)**: server.ts의 `// ----`
// 섹션 헤더 주석은 실제 라우트 내용 경계와 항상 일치하지 않는다 -
// 예를 들어 "팀/그룹/프로젝트" 헤더 바로 아래엔 팀 라우트만 있고,
// 프로젝트 그룹/프로젝트 라우트는 그보다 한참 뒤(API 키 섹션 끝)에
// 헤더 없이 이어져 있었다. 이 배치는 헤더 위치가 아니라 실제
// 경로(`/api/auth/me/*`, `/api/admin/*`, `/api/users*`)를 확인해
// 다시 스코프를 잡았다 - "프로필/사용자"+"관리자 전용 사용자 관리"+
// "검색 엔진 장애 대응 큐" 세 헤더 구간(원래 계획의 배치 2 앞부분)만
// 포함하고, "팀/그룹/프로젝트"는 실제 내용을 다시 확인한 뒤 별도
// 배치로 처리한다.
import { Router } from "express";
import { getMe, updateMe, changeOwnPassword, getPublicProfile, listUsers, listAllUsersForAdmin, listAllUsersForAdminPaged, resetPasswordAsAdmin } from "../../core/auth.js";
import { regenerateGiteaAccessToken } from "../../core/giteaAccounts.js";
import { removeTeamAdmin } from "../../core/teamAdmins.js";
import { removeProjectGroupAdmin } from "../../core/projectGroupAdmins.js";
import { removeMember } from "../../core/members.js";
import { listUserActivity } from "../../core/activity.js";
import { listUserMemberships } from "../../core/userMemberships.js";
import { countMyPendingQuestions, listMyPendingQuestionsPaged } from "../../core/questions.js";
import { listAccessOverridesForUser } from "../../core/permissions.js";
import { getSearchSyncQueueStatus, drainSearchSyncQueue } from "../../core/searchSyncQueue.js";
import { getMonitoringStats } from "../../core/monitoring.js";
import { getOrCreateMqttCredential } from "../../core/emqxAuth.js";
import { authenticate, requireUnrestrictedScope, requireSuperAdmin } from "../../middleware/auth.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// ---------------------------------------------------------------- 프로필/사용자

router.get(
  "/api/auth/me",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await getMe(req.userId!));
  }),
);

router.put(
  "/api/auth/me",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { email, phone, emailVisible, phoneVisible, nickname } = req.body as {
      email?: string;
      phone?: string;
      emailVisible?: boolean;
      phoneVisible?: boolean;
      nickname?: string;
    };
    res.json(await updateMe(req.userId!, { email, phone, emailVisible, phoneVisible, nickname }));
  }),
);

router.post(
  "/api/auth/me/password",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword/newPassword가 필요합니다" });
      return;
    }
    await changeOwnPassword(req.userId!, currentPassword, newPassword);
    res.json({ ok: true });
  }),
);

// Gitea 개인 접근 토큰 재발급 - 기존 토큰을 지우고 새로 발급해 응답에
// 딱 한 번 평문으로 실어 보낸다(ApiKey 생성 시 노출 패턴과 동일). 신원/
// 자격증명 관리라 requireUnrestrictedScope(스코프 있는 키로는 불가).
router.post(
  "/api/auth/me/git-token",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const token = await regenerateGiteaAccessToken(req.userId!);
    const user = await getMe(req.userId!);
    res.json({ username: user.giteaUsername, token });
  }),
);

// "이 설계자가 전체 설치에서 어떤 제한을 받고 있는지" 자기 자신 조회 -
// role 체크 불필요(누구나 자기 자신의 오버라이드는 볼 수 있어야 함).
router.get(
  "/api/auth/me/access-overview",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listAccessOverridesForUser(req.userId!));
  }),
);

// CLI/MCP의 message wait이 EMQX에 직접 구독할 때 쓸 전용 계정을 내려준다
// (#message-wait-mqtt-direct - 백엔드가 대신 구독하지 않고 클라이언트가
// 직접 구독하도록 전환). PUBLIC_EMQX_MQTT_URL이 설정 안 돼 있으면(로컬
// 최소 구성 등) mqttUrl을 null로 돌려주고, 호출부는 기존 HTTP 폴링
// 방식으로 폴백한다(fail-soft - PUBLIC_EMQX_WS_URL 미설정 시 웹 UI
// 실시간 갱신만 조용히 꺼지는 것과 같은 원칙).
router.get(
  "/api/auth/me/mqtt-credentials",
  authenticate,
  asyncRoute(async (req, res) => {
    const mqttUrl = process.env.PUBLIC_EMQX_MQTT_URL ?? null;
    if (!mqttUrl) { res.json({ mqttUrl: null, username: null, password: null }); return; }
    const cred = await getOrCreateMqttCredential(req.userId!);
    res.json({ mqttUrl, ...cred });
  }),
);

// 사이드바 알림 종 배지/목록이 씀(#notification-bell) - 내가 속한
// 모든 프로젝트를 통틀어 "답변 대기"(open+pending) 질의.
router.get(
  "/api/auth/me/pending-questions/count",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json({ count: await countMyPendingQuestions(req.userId!) });
  }),
);

router.get(
  "/api/auth/me/pending-questions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.json(await listMyPendingQuestionsPaged(req.userId!, page, pageSize));
  }),
);

// ---------------------------------------------------------------- 관리자 전용 사용자 관리
// /api/admin/* - admin 전용임을 경로 자체가 드러낸다(이 저장소 첫
// admin 네임스페이스). 이메일 발송 인프라가 없어 self-service 비밀번호
// 재설정 대신 admin이 대행한다(설계자 확정 - #password-reset).
router.get(
  "/api/admin/users",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    res.json(await listAllUsersForAdmin());
  }),
);

router.get(
  "/api/admin/users/page",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(
      await listAllUsersForAdminPaged(
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
        req.query.search as string | undefined,
      ),
    );
  }),
);

router.post(
  "/api/admin/users/:userId/reset-password",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(await resetPasswordAsAdmin(req.params.userId));
  }),
);

router.get(
  "/api/admin/users/:userId/access-overview",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(await listAccessOverridesForUser(req.params.userId));
  }),
);

// "소속 조회" 다이얼로그 전용 - 위 access-overview(문서별 세부 제한)와는
// 별개로, 이 사용자가 관리 권한/멤버십을 가진 프로젝트 그룹/팀/프로젝트를
// 한 번에 모아 보여주고, 각 관계를 강제 방출할 수 있게 한다(단, 마지막
// owner/관리자는 각 core 함수의 가드가 거부).
router.get(
  "/api/admin/users/:userId/memberships",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    res.json(await listUserMemberships(req.params.userId));
  }),
);

router.delete(
  "/api/admin/users/:userId/memberships/projects/:projectId",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    await removeMember(req.params.projectId, req.params.userId);
    res.json({ ok: true });
  }),
);

router.delete(
  "/api/admin/users/:userId/memberships/teams/:teamId",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    await removeTeamAdmin(req.params.teamId, req.params.userId);
    res.json({ ok: true });
  }),
);

router.delete(
  "/api/admin/users/:userId/memberships/groups/:groupId",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    await removeProjectGroupAdmin(req.params.groupId, req.params.userId);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- 검색 엔진 장애 대응 큐 (관리자 전용)
// Meilisearch 장애 중 밀린 색인 쓰기 큐의 상태 조회/수동 드레인
// (#meilisearch-spof) - 30초 주기 백그라운드 워커(main() 참고)가
// 자동으로 비우지만, 장애 해소를 확인한 관리자가 기다리지 않고 즉시
// 비울 수 있게 수동 트리거도 둔다.
router.get(
  "/api/admin/search-queue",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    res.json(await getSearchSyncQueueStatus());
  }),
);

router.post(
  "/api/admin/search-queue/drain",
  authenticate,
  requireUnrestrictedScope,
  requireSuperAdmin,
  asyncRoute(async (_req, res) => {
    res.json(await drainSearchSyncQueue());
  }),
);

// #usage-monitoring - 설치 전체 통계(superAdmin 전용, projectId
// 구분 없이 모든 프로젝트 합산). 프로젝트별 통계는 아래
// /api/projects/:projectId/monitoring/stats 참고(viewer 이상).
router.get(
  "/api/monitoring/stats",
  authenticate,
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json(await getMonitoringStats(null, limit));
  }),
);

// 사용자 선택기(엔티티 선택기 kind="user")용 - 이 시스템엔 조직 간
// 격리가 없어(단일 설치) 로그인한 누구나 설계자 목록을 검색할 수 있다.
router.get(
  "/api/users",
  authenticate,
  asyncRoute(async (req, res) => {
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await listUsers(search, limit));
  }),
);

router.get(
  "/api/users/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await getPublicProfile(req.userId!, req.params.userId));
  }),
);

router.get(
  "/api/users/:userId/activity",
  authenticate,
  asyncRoute(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    res.json(await listUserActivity(req.userId!, req.params.userId, limit));
  }),
);

export default router;
