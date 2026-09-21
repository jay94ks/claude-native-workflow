import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiClient, resolveClientConfig, type Action } from "@cnw/shared";

const config = resolveClientConfig();
const client = new ApiClient(config.endpoint, config.apiKey);

const server = new McpServer({ name: "cnw-mcp", version: "0.0.1" });

// 조회(query)와 변경(action) 두 도구로만 나눈다 - docs/design-notes.md
// "MCP - 조회/변경 도구 분리": 도구 하나로 뭉치면 조회/변경의 승인 성격
// 차이를 도구 단위로 구분할 수 없어진다.
//
// @modelcontextprotocol/sdk 1.30 + zod 3.25.76 조합에서 registerTool()의
// 타입이 "Type instantiation is excessively deep" 오류를 낸다 - 최소
// 재현(단일 registerTool 호출만 있는 파일)에서도 재현되는 SDK 쪽 타입
// 정의 문제로 판단했다(zod의 ZodString/ZodEffects 내부 타입이 SDK가
// 기대하는 형태와 구조적으로 어긋남). 런타임 동작(tsx로는 정상 동작,
// MCP 프로토콜 핸드셰이크도 확인됨)에는 영향이 없으므로, `registerTool`
// 호출 자체를 `any`로 캐스팅해 우회한다 - SDK/zod 버전이 갱신되면
// 제거를 시도해볼 것(design-notes.md Phase 1 기록 참고).
const registerTool = server.registerTool.bind(server) as (...args: any[]) => unknown;

const queryActions = [
  "docs.get",
  "docs.list",
  "docs.search",
  "docs.status",
  "docs.grep",
  "remember.list",
  "message.list",
  "project.get",
  "project.list",
  "project.members",
  "project.invitesForMe",
  "template.get",
  "webhook.list",
  "repo.branches",
  "repo.tree",
  "repo.file",
  "repo.commits",
  "pr.list",
  "pr.get",
  "account.list",
  "account.me",
  "apiKey.list",
  "apiKey.listForProject",
];
const mutationActions = [
  "docs.add",
  "docs.update",
  "docs.delete",
  "docs.transition",
  "docs.tag",
  "remember.add",
  "remember.update",
  "remember.delete",
  "message.send",
  "message.transition",
  "repo.push",
  "repo.connectGitea",
  "project.create",
  "project.update",
  "project.invite",
  "project.acceptInvite",
  "project.transfer",
  "project.transferOwnership",
  "project.destroy",
  "template.set",
  "template.delete",
  "template.deploy",
  "webhook.add",
  "webhook.delete",
  "pr.create",
  "pr.update",
  "pr.merge",
  "pr.close",
  "repo.writeFile",
  "account.changePassword",
  "account.updateNickname",
  "account.resetPassword",
  "account.disable",
  "account.enable",
  "account.delete",
  "apiKey.create",
  "apiKey.revoke",
];

async function runAction(action: string, payload: Record<string, unknown> | undefined) {
  // 설계자 요청(2026-09-21 후속) - project id는 이제 그 생성자(owner)
  // 범위에서만 유일하므로 owner도 항상 같이 보낸다(project.create/list처럼
  // 이 값이 필요 없는 액션은 서버가 무시한다).
  const result = await client.runOne({ action, owner: config.owner, projectId: config.projectId, ...(payload ?? {}) } as Action);
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

registerTool(
  "docs_query",
  {
    description: `Read-only document queries. action must be one of: ${queryActions.join(", ")}.`,
    inputSchema: { action: z.string(), payload: z.record(z.unknown()).optional() },
  },
  async ({ action, payload }: { action: string; payload?: Record<string, unknown> }) => {
    if (!queryActions.includes(action)) {
      return { content: [{ type: "text" as const, text: `unknown query action "${action}"` }], isError: true };
    }
    return runAction(action, payload);
  }
);

registerTool(
  "docs_action",
  {
    description: `Mutating document/remember/repo actions. action must be one of: ${mutationActions.join(", ")}.`,
    inputSchema: { action: z.string(), payload: z.record(z.unknown()).optional() },
  },
  async ({ action, payload }: { action: string; payload?: Record<string, unknown> }) => {
    if (!mutationActions.includes(action)) {
      return { content: [{ type: "text" as const, text: `unknown mutation action "${action}"` }], isError: true };
    }
    return runAction(action, payload);
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
