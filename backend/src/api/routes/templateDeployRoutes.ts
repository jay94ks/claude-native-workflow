// 배치 8i(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 템플릿 배포(Phase 2 - Gitea 저장소 루트에 실제 커밋). server.ts에서
// 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import { requireGiteaWorkingRef } from "../../core/gitRepos.js";
import * as gitea from "../../core/gitea.js";
import { resolveTemplate } from "../../core/templates.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { asyncRoute } from "../shared.js";

const router = Router();

router.post(
  "/api/projects/:projectId/templates/deploy",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const projectId = req.params.projectId;
    const target = await requireGiteaWorkingRef(projectId);
    const deployed: string[] = [];

    const claudeMd = await resolveTemplate("CLAUDE.md", projectId);
    if (claudeMd) {
      await gitea.putFileContent(projectId, target, "CLAUDE.md", claudeMd.content, "docs: deploy CLAUDE.md template", req.userId);
      deployed.push("CLAUDE.md");
    }
    const skillFilename = ".claude/skills/claude-native-workflow/SKILL.md";
    const skillMd = await resolveTemplate(skillFilename, projectId);
    if (skillMd) {
      await gitea.putFileContent(projectId, target, skillFilename, skillMd.content, "docs: deploy SKILL.md template", req.userId);
      deployed.push(skillFilename);
    }

    res.json({ ok: true, deployed });
  }),
);

export default router;
