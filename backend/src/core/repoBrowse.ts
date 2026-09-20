// Code 탭(설계자 요청, 2026-09-20) - 프로젝트의 내부 저장소(es-git)를
// 그대로 브라우징한다: 브랜치 목록/파일 트리/파일 내용/최근 커밋.
// 외부 저장소 clone/캐싱은 스코프 밖(design-notes.md 기록) - 이미 로컬에
// 있는 내부 저장소 자체가 "캐시" 역할이다.

import { requireMembership, MembershipError } from "./membership";
import { listBranches, listTree, readFile, listCommits, commitFile } from "./gitRepo";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

async function guardRead(projectId: unknown, ctx: ActionContext): Promise<ActionResult | null> {
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
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

export async function repoBranches(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const branches = await listBranches(payload.projectId);
  return { ok: true, data: { items: branches } };
}

export async function repoTree(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");

  const entries = await listTree(projectId, branch, typeof path === "string" ? path : "");
  if (entries === null) return fail(`"${branch}" 브랜치의 "${path ?? ""}" 경로를 찾을 수 없습니다(저장소가 비어있을 수도 있습니다).`);
  return { ok: true, data: { path: path ?? "", items: entries } };
}

export async function repoFile(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  if (typeof path !== "string" || !path) return fail("path가 필요합니다.");

  const file = await readFile(projectId, branch, path);
  if (file === null) return fail(`"${branch}"의 "${path}"를 찾을 수 없습니다.`);
  return { ok: true, data: file };
}

/** Code 탭의 "README.md 작성하기"(설계자 요청, 2026-09-20) - 임의 파일 하나를 특정 브랜치에 커밋한다. */
export async function repoWriteFile(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardWrite(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path, content, message } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  if (typeof path !== "string" || !path) return fail("path가 필요합니다.");
  if (typeof content !== "string") return fail("content가 필요합니다.");

  const author = { name: ctx.channel, email: `${ctx.channel}@cnw.local` };
  const result = await commitFile(projectId, path, content, typeof message === "string" && message ? message : `update ${path}`, author, branch);
  return { ok: true, data: result };
}

export async function repoCommits(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  const limit = typeof payload.limit === "number" && payload.limit > 0 ? Math.min(payload.limit, 100) : 30;

  const commits = await listCommits(projectId, branch, limit);
  return { ok: true, data: { items: commits } };
}
