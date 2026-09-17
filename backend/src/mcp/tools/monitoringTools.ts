// 배치 2h(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 사용
// 모니터링(#usage-monitoring). mcp/server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜. 원래 "문서" 섹션 한가운데 물리적으로 끼어
// 있었다(헤더/내용 불일치 - #58에서 반복 발견된 패턴과 동일, 실제
// 경로 접두사를 grep으로 확인해 발견).
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerMonitoringTools(tool: ToolRegistrar): void {
  tool(
    "monitoring_stats",
    "사용 통계(프로젝트)",
    "이 프로젝트의 명령 사용 빈도 + 연이은 패턴(A 다음 B) 통계 - CLI/MCP 명령 이름으로 라벨링돼 나온다(매핑 없는 라우트는 raw route). \"어떤 요청/명령/흐름이 자주 목격되는지\"를 보고 어떤 기능을 유지/보완/수정/추가할지 판단하는 용도 - SKILL.md 등 지침 문서와 나란히 비교하면 좋다.",
    { projectId: z.string(), limit: z.number().optional() },
    async (a) => call(`/api/projects/${a.projectId}/monitoring/stats?${new URLSearchParams({ limit: String(a.limit ?? 20) })}`),
  );
  tool(
    "monitoring_stats_all",
    "사용 통계(설치 전체)",
    "모든 프로젝트를 합산한 사용 통계 - superAdmin 전용(그 외 계정은 403).",
    { limit: z.number().optional() },
    async (a) => call(`/api/monitoring/stats?${new URLSearchParams({ limit: String(a.limit ?? 20) })}`),
  );
}
