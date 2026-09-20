// Pull requests 탭(설계자 요청, 2026-09-20) - 브랜치 비교/머지라는
// git 고유의 시맨틱이라 Document 타입 체계에 얹지 않고 별도 엔티티로
// 뒀다. diff는 저장하지 않고 매번 es-git으로 계산한다(gitRepo.ts).

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { listBranches, diffBranches, mergeBranches } from "./gitRepo";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

async function guardWrite(projectId: unknown, ctx: ActionContext): Promise<ActionResult | null> {
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "WRITE");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}

function toResponse(pr: {
  id: string;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  author: string;
  mergeCommitId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    state: pr.state,
    author: pr.author,
    mergeCommitId: pr.mergeCommitId,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

export async function prCreate(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardWrite(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, title, description, sourceBranch, targetBranch } = payload;
  if (typeof title !== "string" || !title) return fail("title이 필요합니다.");
  if (typeof sourceBranch !== "string" || !sourceBranch) return fail("sourceBranch가 필요합니다.");
  if (typeof targetBranch !== "string" || !targetBranch) return fail("targetBranch가 필요합니다.");
  if (sourceBranch === targetBranch) return fail("sourceBranch와 targetBranch가 같을 수 없습니다.");

  const branches = await listBranches(projectId);
  const names = new Set(branches.map((b) => b.name));
  if (!names.has(sourceBranch)) return fail(`"${sourceBranch}" 브랜치를 찾을 수 없습니다.`);
  if (!names.has(targetBranch)) return fail(`"${targetBranch}" 브랜치를 찾을 수 없습니다.`);

  const pr = await prisma.pullRequest.create({
    data: { projectId, title, description: description ?? "", sourceBranch, targetBranch, author: ctx.channel },
  });
  return { ok: true, data: toResponse(pr) };
}

export async function prList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  if (typeof payload.projectId !== "string" || !payload.projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(payload.projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const { projectId, state } = payload;
  const items = await prisma.pullRequest.findMany({
    where: { projectId, ...(state ? { state } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return { ok: true, data: { items: items.map(toResponse) } };
}

export async function prGet(payload: any, ctx: ActionContext): Promise<ActionResult> {
  if (typeof payload.projectId !== "string" || !payload.projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(payload.projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const { projectId, id } = payload;
  const pr = await prisma.pullRequest.findFirst({ where: { id, projectId } });
  if (!pr) return fail(`PR ${id}를 찾을 수 없습니다.`);

  const diff = await diffBranches(projectId, pr.targetBranch, pr.sourceBranch);
  return { ok: true, data: { ...toResponse(pr), diff: diff ?? { files: [], patch: "" } } };
}

export async function prMerge(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardWrite(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, id } = payload;
  const pr = await prisma.pullRequest.findFirst({ where: { id, projectId } });
  if (!pr) return fail(`PR ${id}를 찾을 수 없습니다.`);
  if (pr.state !== "open") return fail(`이미 ${pr.state} 상태인 PR은 머지할 수 없습니다.`);

  const author = { name: ctx.channel, email: `${ctx.channel}@cnw.local` };
  const result = await mergeBranches(
    projectId,
    pr.sourceBranch,
    pr.targetBranch,
    `Merge "${pr.title}" (${pr.sourceBranch} -> ${pr.targetBranch})`,
    author
  );
  if (!result.ok) return fail(result.reason);

  const updated = await prisma.pullRequest.update({
    where: { id: pr.id },
    data: { state: "merged", mergeCommitId: result.commitId },
  });
  return { ok: true, data: toResponse(updated) };
}

export async function prClose(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardWrite(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, id } = payload;
  const pr = await prisma.pullRequest.findFirst({ where: { id, projectId } });
  if (!pr) return fail(`PR ${id}를 찾을 수 없습니다.`);
  if (pr.state !== "open") return fail(`이미 ${pr.state} 상태입니다.`);

  const updated = await prisma.pullRequest.update({ where: { id: pr.id }, data: { state: "closed" } });
  return { ok: true, data: toResponse(updated) };
}
