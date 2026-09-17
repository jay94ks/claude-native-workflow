#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createToolRegistrar } from "./shared.js";
import { registerAuthTools } from "./tools/authTools.js";
import { registerCredentialTools } from "./tools/credentialTools.js";
import { registerRelationTools } from "./tools/relationTools.js";
import { registerPrTools } from "./tools/prTools.js";
import { registerOpinionTools } from "./tools/opinionTools.js";
import { registerOrgTools } from "./tools/orgTools.js";
import { registerDocTypeTools } from "./tools/docTypeTools.js";
import { registerDocumentTools } from "./tools/documentTools.js";
import { registerMonitoringTools } from "./tools/monitoringTools.js";
import { registerAccessControlTools } from "./tools/accessControlTools.js";
import { registerKanbanTools } from "./tools/kanbanTools.js";
import { registerReportTools } from "./tools/reportTools.js";
import { registerPlanTools } from "./tools/planTools.js";
import { registerQuestionTools } from "./tools/questionTools.js";
import { registerTemplateTools } from "./tools/templateTools.js";
import { registerGitRepoTools } from "./tools/gitRepoTools.js";
import { registerGitFileTools } from "./tools/gitFileTools.js";
import { registerGitStagingTools } from "./tools/gitStagingTools.js";
import { registerPushHookTools } from "./tools/pushHookTools.js";
import { registerMessageTools } from "./tools/messageTools.js";
import { registerSessionTools } from "./tools/sessionTools.js";
import { registerSearchQueueTools } from "./tools/searchQueueTools.js";
import { registerMigrateTools } from "./tools/migrateTools.js";

// cli/index.ts의 모든 명령을 1:1로 미러링한다("CLI/MCP 명령어 완전성"
// 원칙 - 대칭이 깨지면 어느 한쪽에서만 되는 동작이 생긴다). CLI와 마찬가지로
// core/를 직접 호출하지 않고 REST API만 호출하는 순수 클라이언트다 -
// 개인 PC/서버/클라우드 배포 형태를 API 계층 하나로 통일하기 위해서다.
// auth register/login/logout은 도구로 노출하지 않는다(비밀번호가 대화
// 컨텍스트에 남는 걸 피하기 위해 - CLI로 미리 `docs auth login`을 한 번
// 해두는 걸 전제로 한다). 진단용으로 auth_whoami만 예외로 둔다.
// message_wait만 이 "REST만 호출" 원칙의 의도적 예외다(설계자 지시 -
// #message-wait-mqtt-direct) - 자격증명은 여전히 REST(GET /api/auth/me/
// mqtt-credentials)로만 받아오지만, 실제 대기는 EMQX에 직접 구독해서
// 한다(cli/apiclient.ts의 waitForMessageDirect() 참고) - 백엔드가 그
// 구독을 대신 떠맡아 오래 블로킹하지 않기 위해서다.

async function main() {
  const server = new McpServer({ name: "claude-native-workflow", version: "0.1.0" });
  const tool = createToolRegistrar(server);

  registerAuthTools(tool);
  registerCredentialTools(tool);

  registerRelationTools(tool);

  registerPrTools(tool);

  registerOrgTools(tool);

  registerDocTypeTools(tool);
  registerDocumentTools(tool);
  registerMonitoringTools(tool);

  registerAccessControlTools(tool);
  registerKanbanTools(tool);
  registerReportTools(tool);
  registerPlanTools(tool);

  registerQuestionTools(tool);


  registerOpinionTools(tool);

  registerTemplateTools(tool);

  registerGitRepoTools(tool, server);
  registerGitFileTools(tool);
  registerGitStagingTools(tool);


  registerPushHookTools(tool);
  registerMessageTools(tool);
  registerSessionTools(tool);
  registerSearchQueueTools(tool);
  registerMigrateTools(tool);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
