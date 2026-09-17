#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommands } from "./commands/authCommands.js";
import { registerKeyCommands } from "./commands/keyCommands.js";
import { registerRelationCommands } from "./commands/relationCommands.js";
import { registerPrCommands } from "./commands/prCommands.js";
import { registerOpinionCommands } from "./commands/opinionCommands.js";
import { registerOrgCommands } from "./commands/orgCommands.js";
import { registerDocTypeCommands } from "./commands/docTypeCommands.js";
import { registerDocumentCommands } from "./commands/documentCommands.js";
import { registerAccessControlCommands } from "./commands/accessControlCommands.js";
import { registerKanbanCommands } from "./commands/kanbanCommands.js";
import { registerReportCommands } from "./commands/reportCommands.js";
import { registerPlanCommands } from "./commands/planCommands.js";
import { registerQuestionCommands } from "./commands/questionCommands.js";
import { registerTemplateCommands } from "./commands/templateCommands.js";
import { registerGitRepoCommands } from "./commands/gitRepoCommands.js";
import { registerGitFileCommands } from "./commands/gitFileCommands.js";
import { registerGitStagingCommands } from "./commands/gitStagingCommands.js";
import { registerPushHookCommands } from "./commands/pushHookCommands.js";
import { registerMessageCommands } from "./commands/messageCommands.js";
import { registerSessionCommands } from "./commands/sessionCommands.js";
import { registerSearchQueueCommands } from "./commands/searchQueueCommands.js";
import { registerMonitoringCommands } from "./commands/monitoringCommands.js";
import { registerMigrateCommands } from "./commands/migrateCommands.js";

const program = new Command();
program.name("docs").description("claude-native-workflow v2 문서 워크플로우 CLI").version("0.1.0");

registerAuthCommands(program);
registerKeyCommands(program);
registerRelationCommands(program);
registerPrCommands(program);
registerOpinionCommands(program);
registerOrgCommands(program);
registerDocTypeCommands(program);
registerDocumentCommands(program);
registerAccessControlCommands(program);
registerKanbanCommands(program);
registerReportCommands(program);
registerPlanCommands(program);
registerQuestionCommands(program);
registerTemplateCommands(program);

const gitCmd = registerGitRepoCommands(program);
registerGitFileCommands(gitCmd);
registerGitStagingCommands(gitCmd);

registerPushHookCommands(program);
registerMessageCommands(program);
registerSessionCommands(program);
registerSearchQueueCommands(program);
registerMonitoringCommands(program);
registerMigrateCommands(program);
program.parse();
