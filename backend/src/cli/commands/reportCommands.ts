// 배치 2i(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 보고서.
// cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import fs from "node:fs";
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerReportCommands(program: Command): void {
  program
    .command("report-new <projectId>")
    .description("여러 문서를 링크로 엮는 보고서를 생성한다 - 응답에 본문은 없음(호출자가 이미 보낸 내용), 본문이 필요하면 get/read/grep으로 이어서 조회한다")
    .requiredOption("--title <t>")
    .requiredOption("--body <file>")
    .option("--links <codes>", "쉼표로 구분된 trackingCode 목록")
    .action((projectId, opts) =>
      run(async () => {
        const body = fs.readFileSync(opts.body, "utf-8");
        const links = opts.links ? String(opts.links).split(",").map((s: string) => s.trim()) : undefined;
        printJson(
          await apiCall(`/api/projects/${projectId}/reports`, {
            method: "POST",
            body: JSON.stringify({ title: opts.title, body, links }),
          }),
        );
      }),
    );
}
