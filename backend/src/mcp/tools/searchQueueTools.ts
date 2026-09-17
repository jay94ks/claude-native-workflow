// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 검색
// 엔진 장애 대응 큐(관리자 전용). mcp/server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
import { call, type ToolRegistrar } from "../shared.js";

export function registerSearchQueueTools(tool: ToolRegistrar): void {
  tool(
    "search_queue_status",
    "검색 동기화 큐 상태",
    "Meilisearch 장애 중 밀린 색인 쓰기 큐의 현재 상태를 조회한다(관리자 전용) - 30초 주기 워커가 자동으로 비우지만, 장애가 실제로 해소됐는지 확인하는 용도.",
    {},
    async () => call("/api/admin/search-queue"),
  );
  tool(
    "search_queue_drain",
    "검색 동기화 큐 수동 드레인",
    "밀린 색인 쓰기 큐를 즉시 일괄 재처리한다(관리자 전용) - 장애 해소를 확인한 뒤 30초 워커 주기를 기다리지 않고 바로 비우고 싶을 때.",
    {},
    async () => call("/api/admin/search-queue/drain", { method: "POST" }),
  );
}
