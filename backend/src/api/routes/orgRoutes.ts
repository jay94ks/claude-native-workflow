// 배치 2b(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 조직 구조: 팀/프로젝트 그룹/프로젝트. server.ts에서 그대로 잘라낸
// 것 - 로직은 전혀 안 바뀜.
//
// **주의(#58 배치 작업 중 실측으로 발견, 코드 관계도/DN 참고)**:
// server.ts 원본에서 이 세 도메인은 물리적으로 붙어있지 않았다 -
// "팀/그룹/프로젝트" 헤더 아래엔 팀 라우트만 있었고, 프로젝트 그룹/
// 프로젝트 라우트는 그 뒤 "API 키" 섹션이 끝난 자리에 헤더 없이
// 이어져 있었다. 이 파일은 논리적 도메인 기준으로 둘을 합쳤다 -
// `/api/projects/:projectId/api-keys`(API 키 섹션, 아직 server.ts에
// 남아있음)와 `/api/projects/:projectId`(이 파일)는 세그먼트 수가
// 달라 경로 패턴이 겹치지 않으므로 등록 순서 무관하게 안전하다
// (실측 확인).
import { Router } from "express";
import { createTeam, listTeams, listTeamsPaged, updateTeam, deleteTeam, listMembersForTeam, listMembersForTeamPaged } from "../../core/teams.js";
import { addTeamAdmin, removeTeamAdmin, listTeamAdmins, listTeamAdminsPaged, isTeamAllowedByActiveScope, isTeamAdmin } from "../../core/teamAdmins.js";
import {
  createProjectGroup,
  listProjectGroups,
  listProjectGroupsPaged,
  isGroupAllowedByActiveScope,
  updateProjectGroup,
  deleteProjectGroup,
  listMembersForGroup,
  listMembersForGroupPaged,
  getProjectGroupById,
} from "../../core/projectGroups.js";
import {
  addProjectGroupAdmin,
  removeProjectGroupAdmin,
  listProjectGroupAdmins,
  listProjectGroupAdminsPaged,
  isProjectGroupAdmin,
} from "../../core/projectGroupAdmins.js";
import {
  createProject,
  getProject,
  listProjects,
  listProjectsPaged,
  canSeeProject,
  setProjectHidden,
  setProjectPublic,
  deleteProject,
  getOwningTeamId,
} from "../../core/projects.js";
import { addMember, listMembers, listMembersPaged, getMemberRole, removeMember, updateMemberRole } from "../../core/members.js";
import { authenticate, requireUnrestrictedScope, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy, assertDefined } from "../httpValidation.js";
import { asyncRoute, withNotices, pendingQuestionNotice } from "../shared.js";

const router = Router();

// ---------------------------------------------------------------- 팀

router.post(
  "/api/teams",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { name, isPublic } = req.body as { name?: string; isPublic?: boolean };
    assertTruthy(name, "name이 필요합니다");
    res.json(await createTeam(name, req.userId!, isPublic));
  }),
);

router.get(
  "/api/teams",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listTeams(req.userId!));
  }),
);

router.get(
  "/api/teams/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listTeamsPaged(req.userId!, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

router.put(
  "/api/teams/:teamId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 수정할 수 있습니다" });
      return;
    }
    const { name, enabled, isPublic } = req.body as { name?: string; enabled?: boolean; isPublic?: boolean };
    res.json(await updateTeam(req.params.teamId, { name, enabled, isPublic }));
  }),
);

router.delete(
  "/api/teams/:teamId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 삭제할 수 있습니다" });
      return;
    }
    await deleteTeam(req.params.teamId);
    res.json({ ok: true });
  }),
);

// 팀 멤버 가시성(보안 요구사항) - 그 팀 산하 전체 프로젝트의 멤버를
// 관리자만 볼 수 있다.
router.get(
  "/api/teams/:teamId/members",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 멤버 목록을 볼 수 있습니다" });
      return;
    }
    res.json(await listMembersForTeam(req.params.teamId));
  }),
);

router.get(
  "/api/teams/:teamId/members/page",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 멤버 목록을 볼 수 있습니다" });
      return;
    }
    res.json(await listMembersForTeamPaged(req.params.teamId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// 팀장 관리 - API 키의 "어느 팀까지"(스코프) 제한에 더해, 실제로 그
// 팀의 팀장인지도 확인한다(과거엔 authenticate만 요구해 아무 설계자나
// 자기 자신을 팀장으로 등록할 수 있었다 - 이번 보안 강화 라운드에서
// 발견해 닫은 허점. 새로 만든 팀은 생성자가 자동으로 팀장 등록돼
// 있으니 이 요구를 항상 만족한다).
router.post(
  "/api/teams/:teamId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 팀장을 등록할 수 있습니다" });
      return;
    }
    const { userId } = req.body as { userId?: string };
    assertTruthy(userId, "userId가 필요합니다");
    res.json(await addTeamAdmin(req.params.teamId, userId));
  }),
);

router.delete(
  "/api/teams/:teamId/admins/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isTeamAdmin(req.params.teamId, req.userId!))) {
      res.status(403).json({ error: "이 팀의 관리자만 팀장을 해제할 수 있습니다" });
      return;
    }
    await removeTeamAdmin(req.params.teamId, req.params.userId);
    res.json({ ok: true });
  }),
);

router.get(
  "/api/teams/:teamId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(await listTeamAdmins(req.params.teamId));
  }),
);

router.get(
  "/api/teams/:teamId/admins/page",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isTeamAllowedByActiveScope(req.params.teamId)) {
      res.status(403).json({ error: "이 API 키로는 이 팀을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(await listTeamAdminsPaged(req.params.teamId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// ---------------------------------------------------------------- 프로젝트 그룹

router.post(
  "/api/project-groups",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { name, teamId, isPublic } = req.body as { name?: string; teamId?: string; isPublic?: boolean };
    assertTruthy(name, "name이 필요합니다");
    res.json(await createProjectGroup(name, teamId, req.userId!, isPublic));
  }),
);

router.get(
  "/api/project-groups",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjectGroups(req.query.teamId as string | undefined, req.userId!));
  }),
);

router.get(
  "/api/project-groups/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(
      await listProjectGroupsPaged(
        req.query.teamId as string | undefined,
        req.userId!,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

router.put(
  "/api/project-groups/:groupId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 수정할 수 있습니다" });
      return;
    }
    const { name, teamId: rawTeamId, isPublic } = req.body as { name?: string; teamId?: string | null; isPublic?: boolean };
    if (name === undefined && rawTeamId === undefined && isPublic === undefined) {
      res.status(400).json({ error: "name, teamId, isPublic 중 하나는 있어야 합니다" });
      return;
    }
    // 빈 문자열도 "팀 없음"으로 정규화(그룹 생성 라우트와 같은 관례).
    const teamId = rawTeamId === undefined ? undefined : rawTeamId || null;
    if (teamId !== undefined && teamId !== null) {
      const current = await getProjectGroupById(req.params.groupId);
      if (teamId !== current?.teamId && !(await isTeamAdmin(teamId, req.userId!))) {
        res.status(403).json({ error: "대상 팀의 팀장만 그 팀으로 그룹을 옮길 수 있습니다" });
        return;
      }
    }
    res.json(await updateProjectGroup(req.params.groupId, { name, teamId, isPublic }));
  }),
);

router.delete(
  "/api/project-groups/:groupId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 삭제할 수 있습니다" });
      return;
    }
    await deleteProjectGroup(req.params.groupId);
    res.json({ ok: true });
  }),
);

// 그룹 멤버 가시성(보안 요구사항) - 그 그룹 산하 전체 프로젝트의
// 멤버를 관리자만 볼 수 있다.
router.get(
  "/api/project-groups/:groupId/members",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 멤버 목록을 볼 수 있습니다" });
      return;
    }
    res.json(await listMembersForGroup(req.params.groupId));
  }),
);

router.get(
  "/api/project-groups/:groupId/members/page",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 멤버 목록을 볼 수 있습니다" });
      return;
    }
    res.json(
      await listMembersForGroupPaged(req.params.groupId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

// 그룹 관리자 관리 - 팀장 관리 라우트와 동일한 패턴(스코프 확인 +
// 실제 관리자인지 확인). isProjectGroupAdmin()이 팀장 상속을 포함하므로
// 그 그룹이 속한 팀의 팀장도 그룹 관리자를 등록/해제할 수 있다.
router.post(
  "/api/project-groups/:groupId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 그룹 관리자를 등록할 수 있습니다" });
      return;
    }
    const { userId } = req.body as { userId?: string };
    assertTruthy(userId, "userId가 필요합니다");
    res.json(await addProjectGroupAdmin(req.params.groupId, userId));
  }),
);

router.delete(
  "/api/project-groups/:groupId/admins/:userId",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    if (!(await isProjectGroupAdmin(req.params.groupId, req.userId!))) {
      res.status(403).json({ error: "이 그룹의 관리자만 그룹 관리자를 해제할 수 있습니다" });
      return;
    }
    await removeProjectGroupAdmin(req.params.groupId, req.params.userId);
    res.json({ ok: true });
  }),
);

router.get(
  "/api/project-groups/:groupId/admins",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(await listProjectGroupAdmins(req.params.groupId));
  }),
);

router.get(
  "/api/project-groups/:groupId/admins/page",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await isGroupAllowedByActiveScope(req.params.groupId))) {
      res.status(403).json({ error: "이 API 키로는 이 그룹을 대상으로 작업할 수 없습니다" });
      return;
    }
    res.json(
      await listProjectGroupAdminsPaged(req.params.groupId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)),
    );
  }),
);

// ---------------------------------------------------------------- 프로젝트

router.post(
  "/api/projects",
  authenticate,
  requireUnrestrictedScope,
  asyncRoute(async (req, res) => {
    const { name, projectGroupId, isPublic } = req.body as { name?: string; projectGroupId?: string; isPublic?: boolean };
    assertTruthy(name, "name이 필요합니다");
    const project = await createProject(name, projectGroupId, isPublic);
    await addMember(project.id, req.userId!, "owner");
    res.json(project);
  }),
);

router.get(
  "/api/projects",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await listProjects(req.query.projectGroupId as string | undefined, req.userId!));
  }),
);

router.get(
  "/api/projects/page",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(
      await listProjectsPaged(
        req.query.projectGroupId as string | undefined,
        req.userId!,
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

// 멤버가 아니어도 팀장/그룹 관리자거나 공개+그룹 읽기 권한이 있으면
// 존재를 열어볼 수 있어야 한다 - requireProjectRole 단독이 아니라,
// 그 체크가 실패해도 canSeeProject로 한 번 더 확인하는 인라인 체크로
// 교체. 이렇게 봐도 자동으로 프로젝트 내용까지 볼 권한을 얻는 건
// 아니다 - 이 라우트(존재 확인)만 이렇게 넓고, 문서/멤버 등 다른
// 라우트는 그대로 requireProjectRole 유지.
router.get(
  "/api/projects/:projectId",
  authenticate,
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    const role = await getMemberRole(req.params.projectId, req.userId!);
    if (!role && !(await canSeeProject(project, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" });
      return;
    }
    const notice = role ? await pendingQuestionNotice(req.params.projectId) : null;
    res.json(withNotices({ ...project, myRole: role }, notice));
  }),
);

// 프로젝트 완전 삭제("제한구역") - owner 전용(admin은 자동 우회).
// 문서/코멘트/칸반/Q&A 등 DB 데이터가 cascade로 전부 함께 삭제되고,
// 연결된 Gitea 저장소도 같이 삭제된다(deleteProject 참고) - 되돌릴 수
// 없다.
router.delete(
  "/api/projects/:projectId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    await deleteProject(req.params.projectId);
    res.json({ ok: true });
  }),
);

// 프로젝트 owner, 소속 팀의 팀장, 소속 그룹의 관리자만 숨김/공개
// 상태를 바꿀 수 있다(canSeeProject의 admin 우회 집합과 통일 - 예전엔
// 그룹 관리자가 빠져있던 비일관성이 있었음).
async function canManageProjectVisibility(projectId: string, userId: string, projectGroupId: string): Promise<boolean> {
  const role = await getMemberRole(projectId, userId);
  if (role === "owner") return true;
  const teamId = await getOwningTeamId(projectId);
  if (await isTeamAdmin(teamId, userId)) return true;
  return isProjectGroupAdmin(projectGroupId, userId);
}

router.put(
  "/api/projects/:projectId/hidden",
  authenticate,
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    if (!(await canManageProjectVisibility(req.params.projectId, req.userId!, project.projectGroupId))) {
      res.status(403).json({ error: "프로젝트 owner, 팀장, 그룹 관리자만 숨김 상태를 바꿀 수 있습니다" });
      return;
    }
    const { hidden } = req.body as { hidden?: boolean };
    assertDefined(hidden, "hidden이 필요합니다");
    res.json(await setProjectHidden(req.params.projectId, hidden, req.userId!));
  }),
);

router.put(
  "/api/projects/:projectId/public",
  authenticate,
  asyncRoute(async (req, res) => {
    const project = await getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: "not found" }); return; }
    if (!(await canManageProjectVisibility(req.params.projectId, req.userId!, project.projectGroupId))) {
      res.status(403).json({ error: "프로젝트 owner, 팀장, 그룹 관리자만 공개 상태를 바꿀 수 있습니다" });
      return;
    }
    const { isPublic } = req.body as { isPublic?: boolean };
    assertDefined(isPublic, "isPublic이 필요합니다");
    res.json(await setProjectPublic(req.params.projectId, isPublic));
  }),
);

router.post(
  "/api/projects/:projectId/members",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || !role) { res.status(400).json({ error: "userId/role이 필요합니다" }); return; }
    res.json(await addMember(req.params.projectId, userId, role));
  }),
);

router.get(
  "/api/projects/:projectId/members",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMembers(req.params.projectId));
  }),
);

router.get(
  "/api/projects/:projectId/members/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listMembersPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

router.put(
  "/api/projects/:projectId/members/:userId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    const { role } = req.body as { role?: string };
    assertTruthy(role, "role이 필요합니다");
    res.json(await updateMemberRole(req.params.projectId, req.params.userId, role, req.userId!));
  }),
);

router.delete(
  "/api/projects/:projectId/members/:userId",
  authenticate,
  requireProjectRole("owner"),
  asyncRoute(async (req, res) => {
    await removeMember(req.params.projectId, req.params.userId);
    res.json({ ok: true });
  }),
);

export default router;
