// 배치 7d(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 템플릿(CLAUDE.md, SKILL.md 등). server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
import { Router } from "express";
import { resolveTemplate, setTemplateOverride, listTemplateRevisions, listTemplateRevisionsPaged } from "../../core/templates.js";
import { getMemberRole, roleSatisfies, isProjectAllowedByActiveScope } from "../../core/members.js";
import { isTeamAllowedByActiveScope, isTeamAdmin } from "../../core/teamAdmins.js";
import { isGroupAllowedByActiveScope } from "../../core/projectGroups.js";
import { isProjectGroupAdmin } from "../../core/projectGroupAdmins.js";
import { getActiveKeyScope } from "../../core/requestScope.js";
import { isSuperAdmin } from "../../core/auth.js";
import { authenticate } from "../../middleware/auth.js";
import { assertTruthy, assertDefined } from "../httpValidation.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// filename이 ".claude/skills/.../SKILL.md"처럼 슬래시를 포함할 수 있어
// 경로 세그먼트(:filename) 대신 쿼리스트링으로 받는다(Express 경로
// 매칭이 슬래시 포함 값을 세그먼트 하나로 다루지 못함).

router.get(
  "/api/templates",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    assertTruthy(filename, "filename이 필요합니다");
    const projectId = req.query.projectId as string | undefined;
    const resolved = await resolveTemplate(filename, projectId);
    if (!resolved) { res.status(404).json({ error: "not found" }); return; }
    res.json(resolved);
  }),
);

router.put(
  "/api/templates",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    assertTruthy(filename, "filename이 필요합니다");
    const { content, teamId, projectGroupId, projectId } = req.body as {
      content?: string;
      teamId?: string;
      projectGroupId?: string;
      projectId?: string;
    };
    assertDefined(content, "content가 필요합니다");
    // 두 가지를 따로 확인해야 한다(#template-write-role-gate, 실사용
    // 중 발견 - DN-20DB634B가 다음 라운드로 미뤄뒀던 항목) - (1) 활성 API
    // 키 스코프가 이 스코프(프로젝트/팀/그룹/전역)를 다루는 것 자체를
    // 허용하는지(멀티테넌시 경계, 아래 *AllowedByActiveScope), (2) 그
    // 스코프에서 이 사용자가 실제로 쓰기 권한이 있는 역할/관리자인지
    // (권한 등급, 아래 역할/관리자 조회). (1)만 있고 (2)가 없으면 그
    // 프로젝트의 viewer 멤버나 - 스코프 미지정일 땐 - 설치의 아무
    // 로그인 사용자나 이 스코프의 템플릿(전역 기본값까지)을 덮어쓸 수
    // 있었다.
    let scopeAllowed: boolean;
    let roleAllowed: boolean;
    if (projectId) {
      scopeAllowed = await isProjectAllowedByActiveScope(projectId);
      roleAllowed = roleSatisfies(await getMemberRole(projectId, req.userId!), "editor");
    } else if (teamId) {
      scopeAllowed = isTeamAllowedByActiveScope(teamId);
      roleAllowed = await isTeamAdmin(teamId, req.userId!);
    } else if (projectGroupId) {
      scopeAllowed = await isGroupAllowedByActiveScope(projectGroupId);
      roleAllowed = await isProjectGroupAdmin(projectGroupId, req.userId!);
    } else {
      // 스코프 미지정 = "설치 전역 기본값" 수정 - unrestricted(로그인/
      // 개인 키) 스코프에 더해 설치 super admin이어야 한다.
      scopeAllowed = getActiveKeyScope().type === "unrestricted";
      roleAllowed = await isSuperAdmin(req.userId!);
    }
    if (!scopeAllowed) {
      res.status(403).json({ error: "이 API 키로는 이 스코프의 템플릿을 수정할 수 없습니다" });
      return;
    }
    if (!roleAllowed) {
      res.status(403).json({ error: "이 스코프의 템플릿을 수정할 권한이 없습니다" });
      return;
    }
    res.json(await setTemplateOverride(filename, { teamId, projectGroupId, projectId }, content, req.userId!));
  }),
);

router.get(
  "/api/templates/revisions",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    assertTruthy(filename, "filename이 필요합니다");
    const teamId = req.query.teamId as string | undefined;
    const projectGroupId = req.query.projectGroupId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    res.json(await listTemplateRevisions(filename, { teamId, projectGroupId, projectId }));
  }),
);

router.get(
  "/api/templates/revisions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = req.query.filename as string | undefined;
    assertTruthy(filename, "filename이 필요합니다");
    const teamId = req.query.teamId as string | undefined;
    const projectGroupId = req.query.projectGroupId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    res.json(
      await listTemplateRevisionsPaged(
        filename,
        { teamId, projectGroupId, projectId },
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
      ),
    );
  }),
);

export default router;
