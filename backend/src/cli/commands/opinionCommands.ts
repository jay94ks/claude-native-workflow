// 배치 2e(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// 의견(Opinion) - 코멘트와 정반대 채널. cli/index.ts에서 그대로 잘라낸
// 것 - 로직은 전혀 안 바뀜.
//
// 코멘트(웹 UI 전용, comments.ts)는 "설계자들끼리만 공유, AI 참고
// 지표가 될 수 없다"는 원칙으로 CLI/MCP가 없는데, 의견은 AI가 참고해야
// 하는 채널이라 그 반대다 - 문서/계획 화면의 "의견" 버튼으로 설계자가
// 남기고, AI가 여기서 직접 조회·확인 완료 처리한다. 생성 명령은
// 의도적으로 없음(설계자가 웹에서만 남긴다).
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerOpinionCommands(program: Command): void {
  const opinionCmd = program.command("opinion").description("문서/계획에 설계자가 남긴 의견(AI 참고용) - 조회/확인 완료만, 생성은 웹 UI 전용");

  opinionCmd
    .command("pending <projectId>")
    .description("아직 확인하지 않은(open) 의견 목록")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/opinions?${new URLSearchParams({ projectId, status: "open" })}`))));

  opinionCmd
    .command("list <projectId>")
    .description("의견 목록 - --target으로 특정 문서/계획만, --status로 상태 제한(기본 open)")
    .option("--target <trackingCode>", "이 문서/계획의 의견만")
    .option("--status <status>", "open(기본) | resolved | all")
    .action((projectId, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ projectId, status: opts.status ?? "open" });
        if (opts.target) qs.set("targetKey", opts.target);
        printJson(await apiCall(`/api/opinions?${qs}`));
      }),
    );

  opinionCmd
    .command("resolve <opinionId>")
    .description("의견을 확인 완료(resolved)로 표시 - 되돌리기는 지원 안 함")
    .action((opinionId) => run(async () => printJson(await apiCall(`/api/opinions/${opinionId}/resolve`, { method: "POST" }))));
}
