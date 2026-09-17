// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 검색
// 엔진 장애 대응 큐(관리자 전용). cli/index.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerSearchQueueCommands(program: Command): void {
  const searchQueueCmd = program.command("search-queue").description("Meilisearch 장애 시 밀린 색인 동기화 큐(관리자 전용)");
  searchQueueCmd
    .command("status")
    .description("큐 상태 조회 - 30초 주기 워커가 자동으로 비우지만, 장애 해소를 확인하는 용도")
    .action(() => run(async () => printJson(await apiCall("/api/admin/search-queue"))));
  searchQueueCmd
    .command("drain")
    .description("큐를 즉시 일괄 재처리 - 워커 주기를 기다리지 않고 바로 비우고 싶을 때")
    .action(() => run(async () => printJson(await apiCall("/api/admin/search-queue/drain", { method: "POST" }))));
}
