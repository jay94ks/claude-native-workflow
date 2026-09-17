// 배치 2i(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 칸반
// 보드. cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// 코멘트/폴더와 달리 이 기능은 AI에게 완전히 노출된다 - 컬럼 순서/숨김
// 변경과 카드 코멘트만 예외로 CLI/MCP에 없다(개인 UI 설정이거나
// 설계자간 채널).
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerKanbanCommands(program: Command): void {
  program
    .command("kanban-columns <projectId>")
    .description("이 프로젝트의 칸반 분류 목록(순서/숨김은 이 계정 기준)")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/kanban/columns${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("kanban-card-new <projectId> <columnId> <title>")
    .description("칸반 카드를 만들어 분류에 추가한다(AI가 만든 카드로 기록됨)")
    .option("--body <text>", "카드 설명")
    .option("--refs <codes>", "쉼표로 구분된 근거 문서 trackingCode 목록")
    .action((projectId, columnId, title, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/kanban/cards`, {
            method: "POST",
            body: JSON.stringify({
              columnId,
              title,
              body: opts.body,
              refs: opts.refs ? opts.refs.split(",").filter(Boolean) : undefined,
              origin: "ai",
            }),
          }),
        ),
      ),
    );

  program
    .command("kanban-cards <projectId>")
    .description("칸반 카드 목록(숨긴 카드 제외)")
    .option("--column <columnId>", "특정 분류로 제한")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = new URLSearchParams({
          ...(opts.column ? { columnId: opts.column } : {}),
          ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
        });
        const suffix = paged ? "/page" : "";
        printJson(await apiCall(`/api/projects/${projectId}/kanban/cards${suffix}${qs.toString() ? `?${qs}` : ""}`));
      }),
    );

  program
    .command("kanban-card-get <trackingCode>")
    .description("칸반 카드 상세(근거 문서 포함)")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/kanban/cards/${trackingCode}`))));

  program
    .command("kanban-card-move <trackingCode> <toColumnId>")
    .description("칸반 카드를 다른 분류로 옮긴다")
    .option("--index <n>", "그 분류 안에서의 위치(생략 시 맨 끝)")
    .action((trackingCode, toColumnId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/kanban/cards/${trackingCode}/move`, {
            method: "PUT",
            body: JSON.stringify({ toColumnId, toIndex: opts.index !== undefined ? Number(opts.index) : undefined }),
          }),
        ),
      ),
    );
}
