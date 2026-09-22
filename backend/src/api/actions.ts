import * as documents from "../core/documents";
import * as accounts from "../core/accounts";
import * as apiKeys from "../core/apiKeys";
import * as remember from "../core/remember";
import * as messages from "../core/messages";
import * as repo from "../core/repo";
import * as projects from "../core/projects";
import * as templates from "../core/templates";
import * as webhooks from "../core/webhooks";
import * as repoBrowse from "../core/repoBrowse";
import * as pullRequests from "../core/pullRequests";
import * as activityLog from "../core/activityLog";
import { resolveProjectId } from "../core/projectResolve";
import type { ActionResult } from "../core/types";
import type { ActionContext } from "../core/documents";

type Handler = (payload: unknown, ctx: ActionContext) => Promise<ActionResult>;

// action 이름 -> 핸들러. 새 action은 여기 한 줄만 추가하면 된다
// (docs/design-notes.md "API 설계 원칙" - 단일 엔드포인트 + command 패턴).
const registry: Record<string, Handler> = {
  "docs.add": documents.docsAdd,
  "docs.update": documents.docsUpdate,
  "docs.delete": documents.docsDelete,
  "docs.transition": documents.docsTransition,
  "docs.tag": documents.docsTag,
  "docs.get": documents.docsGet,
  "docs.list": documents.docsList,
  "docs.search": documents.docsSearch,
  "docs.status": documents.docsStatus,
  "docs.grep": documents.docsGrep,
  "activity.summary": activityLog.activitySummary,
  "remember.add": remember.rememberAdd,
  "remember.update": remember.rememberUpdate,
  "remember.delete": remember.rememberDelete,
  "remember.list": remember.rememberList,
  "message.send": messages.messageSend,
  "message.list": messages.messageList,
  "message.transition": messages.messageTransition,
  "repo.push": repo.repoPush,
  "repo.connectGitea": repo.repoConnectGitea,
  "project.create": projects.projectCreate,
  "project.get": projects.projectGet,
  "project.list": projects.projectList,
  "project.members": projects.projectMembers,
  "project.invitesForMe": projects.projectInvitesForMe,
  "project.update": projects.projectUpdate,
  "project.invite": projects.projectInvite,
  "project.acceptInvite": projects.projectAcceptInvite,
  "project.transfer": projects.projectTransfer,
  "project.transferOwnership": projects.projectTransferOwnership,
  "project.destroy": projects.projectDestroy,
  "template.set": templates.templateSet,
  "template.get": templates.templateGet,
  "template.delete": templates.templateDelete,
  "template.deploy": templates.templateDeploy,
  "webhook.add": webhooks.webhookAdd,
  "webhook.list": webhooks.webhookList,
  "webhook.delete": webhooks.webhookDelete,
  "repo.branches": repoBrowse.repoBranches,
  "repo.tree": repoBrowse.repoTree,
  "repo.file": repoBrowse.repoFile,
  "repo.commits": repoBrowse.repoCommits,
  "repo.writeFile": repoBrowse.repoWriteFile,
  "repo.commitDiff": repoBrowse.repoCommitDiff,
  "repo.diffFile": repoBrowse.repoDiffFile,
  "repo.fileCommits": repoBrowse.repoFileCommits,
  "repo.commitInfo": repoBrowse.repoCommitInfo,
  "pr.create": pullRequests.prCreate,
  "pr.list": pullRequests.prList,
  "pr.get": pullRequests.prGet,
  "pr.update": pullRequests.prUpdate,
  "pr.merge": pullRequests.prMerge,
  "pr.close": pullRequests.prClose,
  "account.list": accounts.accountList,
  "account.me": accounts.accountMe,
  "account.changePassword": accounts.accountChangePassword,
  "account.updateNickname": accounts.accountUpdateNickname,
  "account.resetPassword": accounts.accountResetPassword,
  "account.disable": accounts.accountDisable,
  "account.enable": accounts.accountEnable,
  "account.delete": accounts.accountDelete,
  "apiKey.create": apiKeys.apiKeyCreate,
  "apiKey.list": apiKeys.apiKeyList,
  "apiKey.listForProject": apiKeys.apiKeyListForProject,
  "apiKey.revoke": apiKeys.apiKeyRevoke,
};

export interface ActionRequest {
  action: string;
  [key: string]: unknown;
}

/**
 * Dispatches one action object to its handler, in request order (bulk = array of these).
 *
 * 실기동 중 발견한 심각한 버그: 이 함수를 호출하는 쪽(api/server.ts)에
 * try/catch가 전혀 없었다 - 액션 핸들러 하나가 처리되지 않은 예외를
 * 던지면(es-git 등 네이티브 바인딩은 이런 경우가 흔하다 - gitRepo.ts
 * "머지 중 발견한 버그" 기록 참고) **백엔드 프로세스 전체가 죽어서 그
 * 순간 접속돼 있던 모든 사용자에게 영향**을 줬다. 여기서 한 번만
 * 감싸면 이 단일 엔드포인트를 거치는 모든 액션(현재/향후 전부)에
 * 자동으로 적용된다 - 실패한 그 액션만 정상적인 {ok:false} 응답이
 * 되고, 나머지 요청/사용자는 영향받지 않는다.
 */
export async function dispatch(request: ActionRequest, ctx: ActionContext): Promise<ActionResult> {
  const handler = registry[request.action];
  if (!handler) {
    return { ok: false, reason: [`unknown action "${request.action}"`] };
  }

  // 설계자 요청(2026-09-21 후속) - project id는 이제 생성자(owner)별로만
  // 유일하다. `owner`(생성자 username) + `projectId`(그 owner 범위의 slug)가
  // 함께 왔으면 이 시점에 실제 내부 PK로 미리 바꿔치기한다 - 아래 모든
  // 핸들러는 지금까지처럼 payload.projectId를 이미 유일하게 식별된 값으로
  // 취급해도 안전하다(owner 개념 자체를 몰라도 됨). owner 없이 projectId만
  // 온 요청(예: 이 필드가 필요 없는 project.create/list 등)은 그대로 통과.
  let payload: ActionRequest = request;
  if (typeof request.owner === "string" && typeof request.projectId === "string") {
    const resolved = await resolveProjectId(request.owner, request.projectId);
    if (!resolved) {
      return { ok: false, reason: [`"${request.owner}/${request.projectId}" 프로젝트를 찾을 수 없습니다.`] };
    }
    payload = { ...request, projectId: resolved };
  }

  try {
    return await handler(payload, ctx);
  } catch (err) {
    console.error(`[actions] "${request.action}" threw an uncaught error:`, err);
    return { ok: false, reason: [`"${request.action}" 처리 중 예상치 못한 오류가 발생했습니다: ${(err as Error).message}`] };
  }
}
