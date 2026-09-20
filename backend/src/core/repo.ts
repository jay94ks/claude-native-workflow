// repo.push - 내부 저장소(es-git)를 프로젝트 설정에 등록된 외부
// push-mirror 대상으로 동기화하는 옵션 기능 (design-notes.md
// "저장소(git) 관리" - 외부 동기화는 설계자가 명시적으로 눌러야 하는 동작).

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { pushToMirror } from "./gitRepo";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

export async function repoPush(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "WRITE");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return fail(`프로젝트 ${projectId}를 찾을 수 없습니다.`);
  if (!project.pushMirrorUrl) {
    return fail("이 프로젝트엔 push-mirror 대상이 설정돼 있지 않습니다(옵션 기능 - 프로젝트 설정에서 지정하세요).");
  }

  try {
    await pushToMirror(projectId, project.pushMirrorUrl);
  } catch (err) {
    return fail(`push 실패: ${(err as Error).message}`);
  }

  return { ok: true };
}
