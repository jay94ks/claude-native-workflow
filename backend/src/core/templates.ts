// template.set / get / delete / deploy - architect별 개인 CLAUDE.md/SKILL.md
// 템플릿 (design-notes.md "프로젝트 설정 항목" - "전역 기본 템플릿이라는
// 건 없다, architect별로 자기 템플릿을 갖는다... 그 프로젝트의 Admin이
// 자신의 템플릿을 골라 배포").

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { commitFile } from "./gitRepo";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

/** architect별 개인 템플릿을 만들거나 덮어쓴다 - 프로젝트와 무관, 계정에 하나뿐. */
export async function templateSet(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { claudeMd, skillMd } = payload;
  if (typeof claudeMd !== "string" || !claudeMd) return fail("claudeMd가 필요합니다.");
  if (typeof skillMd !== "string" || !skillMd) return fail("skillMd가 필요합니다.");

  await prisma.template.upsert({
    where: { ownerAccountId: ctx.architectId },
    update: { claudeMd, skillMd },
    create: { ownerAccountId: ctx.architectId, claudeMd, skillMd },
  });

  return { ok: true };
}

export async function templateGet(_payload: unknown, ctx: ActionContext): Promise<ActionResult> {
  const template = await prisma.template.findUnique({ where: { ownerAccountId: ctx.architectId } });
  if (!template) return fail("아직 템플릿을 만들지 않았습니다 - template.set으로 먼저 만드세요.");
  return { ok: true, data: { claudeMd: template.claudeMd, skillMd: template.skillMd, updatedAt: template.updatedAt } };
}

export async function templateDelete(_payload: unknown, ctx: ActionContext): Promise<ActionResult> {
  await prisma.template.deleteMany({ where: { ownerAccountId: ctx.architectId } });
  return { ok: true };
}

/** 그 프로젝트의 Admin만 - 자신의 템플릿을 그 프로젝트의 내부 저장소에 배포(커밋)한다. */
export async function templateDeploy(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "ADMIN");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const template = await prisma.template.findUnique({ where: { ownerAccountId: ctx.architectId } });
  if (!template) return fail("아직 템플릿을 만들지 않았습니다 - template.set으로 먼저 만드세요.");

  const author = { name: ctx.channel, email: `${ctx.channel}@cnw.local` };
  const claudeCommit = await commitFile(projectId, "CLAUDE.md", template.claudeMd, "deploy CLAUDE.md template", author);
  const skillCommit = await commitFile(
    projectId,
    ".claude/skills/claude-native-workflow/SKILL.md",
    template.skillMd,
    "deploy SKILL.md template",
    author
  );

  return { ok: true, data: { branch: skillCommit.branch, commitId: skillCommit.commitId, claudeMdCommitId: claudeCommit.commitId } };
}
