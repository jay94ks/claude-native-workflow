// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 사용
// 모니터링(#usage-monitoring). cli/index.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜. MCP 쪽은 더 이른 배치(2j)에서 mcp/tools/monitoringTools.ts로
// 이미 분리됐다 - 이 파일은 CLI 전용, MCP 쪽은 손대지 않는다.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerMonitoringCommands(program: Command): void {
  const monitoringCmd = program.command("monitoring").description("사용 통계(명령 빈도 + 연이은 패턴) - 어떤 기능을 유지/보완/추가할지 판단하는 용도");

  monitoringCmd
    .command("stats <projectId>")
    .description("이 프로젝트의 명령 사용 빈도 + 연이은 패턴(A 다음 B) 통계")
    .option("--limit <n>", "상위 몇 건까지(기본 20)")
    .option("--all", "전체(제한 없이)")
    .action((projectId, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ limit: opts.all ? "100000" : (opts.limit ?? "20") });
        printJson(await apiCall(`/api/projects/${projectId}/monitoring/stats?${qs}`));
      }),
    );

  monitoringCmd
    .command("stats-all")
    .description("설치 전체 통계(모든 프로젝트 합산) - superAdmin 전용")
    .option("--limit <n>", "상위 몇 건까지(기본 20)")
    .option("--all", "전체(제한 없이)")
    .action((opts) =>
      run(async () => {
        const qs = new URLSearchParams({ limit: opts.all ? "100000" : (opts.limit ?? "20") });
        printJson(await apiCall(`/api/monitoring/stats?${qs}`));
      }),
    );
}
