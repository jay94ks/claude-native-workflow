// template.set / get / delete / deploy - architect별 개인 CLAUDE.md/SKILL.md
// 템플릿 (design-notes.md "프로젝트 설정 항목" - "전역 기본 템플릿이라는
// 건 없다, architect별로 자기 템플릿을 갖는다... 그 프로젝트의 Admin이
// 자신의 템플릿을 골라 배포").

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { commitFile } from "./gitRepo";
import { formatDisplayLabel } from "./auth";
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

  // design-notes.md("Phase 7 완료 기록") - 원래는 실제 계정 정보를 커밋
  // 작성자에 노출하지 않기로 판단해 `ctx.channel`("agent"/"architect")만
  // 썼다("이메일 등을 아직 노출 안 함, 원하면 다음 라운드에 옵션으로
  // 설계"라고 남겨둠). docs/plan-nickname-apikey-policy.md 이후로는
  // Account에 실제 개인 이메일 필드 자체가 없고(v2와 달리 username만
  // 있음) username/닉네임은 이미 협업자 목록 등 UI 전반에 공개돼 있어
  // 노출 우려가 사실상 사라졌다 - 그 계정의 표시 라벨(닉네임 정책)을
  // 커밋 작성자 이름으로 쓴다(누가 실제로 배포를 눌렀는지 git log에서
  // 바로 보이게).
  const account = await prisma.account.findUnique({ where: { id: ctx.architectId } });
  const author = account
    ? { name: formatDisplayLabel(account.nickname, account.nicknameNumber), email: `${account.username}@cnw.local` }
    : { name: ctx.channel, email: `${ctx.channel}@cnw.local` };
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
