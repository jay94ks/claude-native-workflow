// repo.push - 내부 저장소(es-git)를 프로젝트 설정에 등록된 외부
// push-mirror 대상으로 동기화하는 옵션 기능 (design-notes.md
// "저장소(git) 관리" - 외부 동기화는 설계자가 명시적으로 눌러야 하는 동작).

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { pushToMirror } from "./gitRepo";
import { ensureOrgConfigured, ensureRepoConfigured, orgForProject, CANONICAL_REPO_NAME, config as giteaConfig, GiteaError } from "./gitea";
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

/**
 * docs/plan-gitea-provisioning.md - Admin 전용, 명시적으로 눌러야 하는
 * 동작(v2도 프로젝트 생성 시점 자동이 아니라 "그 프로젝트가 처음 Gitea에
 * 연결되는 시점"에 별도 호출이었다 - 그 정책을 그대로 계승, project.create
 * 는 전혀 안 건드린다). 그 프로젝트 전용 org(`orgForProject`, DB 컬럼
 * 없이 projectId의 순수 함수)를 멱등 생성하고 그 안에 표준 이름
 * (`repo`) 저장소를 멱등 생성한 뒤, **자격증명을 절대 심지 않은** clone
 * URL을 `Project.pushMirrorUrl`에 저장한다(토큰 주입은 gitRepo.ts의
 * pushToMirror가 push 시점에만 메모리 상에서 한다 - DB/응답에 노출 금지).
 * Gitea가 미설정이면 이 액션 자체가 명확한 에러로 거부한다(project.create
 * 등의 fail-soft와 다르게, 설계자가 명시적으로 요청한 연결이므로 조용히
 * 넘어가면 안 된다는 판단).
 */
export async function repoConnectGitea(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "ADMIN");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  if (!giteaConfig()) {
    return fail("GITEA_URL/GITEA_API_TOKEN이 설정돼 있지 않아 이 서버는 Gitea 연동을 쓸 수 없습니다.");
  }

  const org = orgForProject(projectId);
  try {
    await ensureOrgConfigured(org);
    const { cloneUrl } = await ensureRepoConfigured(org, CANONICAL_REPO_NAME);
    // Gitea로 다시 연결하면 이전에 GitHub로 연결돼 있었을 수 있는
    // pushMirrorGithubAccountId를 반드시 지운다 - 안 지우면 Gitea clone
    // URL인데 GitHub 토큰을 credential로 주입하려 드는 상태가 남는다.
    await prisma.project.update({ where: { id: projectId }, data: { pushMirrorUrl: cloneUrl, pushMirrorGithubAccountId: null } });
    return { ok: true, data: { pushMirrorUrl: cloneUrl } };
  } catch (err) {
    if (err instanceof GiteaError) return fail(err.message);
    throw err;
  }
}

/**
 * design-notes.md "GitHub OAuth 연결(push-mirror)" - v2의 "GitHub 로그인
 * + 저장소 선택"에서 저장소 선택 이후 부분만 가져온 것. GitHub는 Gitea와
 * 달리 서버 공유 토큰이 아니라 이 요청을 보낸 architect 개인이 방금
 * OAuth로 연결한 저장소이므로, pushMirrorUrl과 함께 "이 프로젝트의
 * push는 이 architect의 GitHub 토큰을 쓴다"는 것도 같이 기록한다
 * (pushMirrorGithubAccountId - gitRepo.ts의 pushCredentialFor가 push
 * 시점에 이걸로 토큰을 찾는다). cloneUrl은 프론트가 github.listRepos로
 * 받은 목록에서 고른 것을 그대로 받는다(자동 생성 없음 - v2와 동일).
 */
export async function repoConnectGithub(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, cloneUrl } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  if (typeof cloneUrl !== "string" || !cloneUrl) return fail("cloneUrl이 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "ADMIN");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const cred = await prisma.githubCredential.findUnique({ where: { accountId: ctx.architectId } });
  if (!cred) return fail("먼저 GitHub 계정을 연결하세요.");

  await prisma.project.update({ where: { id: projectId }, data: { pushMirrorUrl: cloneUrl, pushMirrorGithubAccountId: ctx.architectId } });
  return { ok: true, data: { pushMirrorUrl: cloneUrl } };
}
