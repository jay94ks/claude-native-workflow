// 배치 2b(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// API 키(신원 위임 인증, 3종) + git 자격증명. cli/index.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜. MCP 도구는 API 키 쪽엔 의도적으로
// 없음(auth register/login과 같은 급의 신원 관리 동작 - CLI 전용,
// 사람이 터미널에서 직접 하는 동작으로 제한).
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerKeyCommands(program: Command): void {
  const keyCmd = program.command("key").description("API 키 관리(팀 관리 키/프로젝트 개인 키/개인 키)");

  keyCmd
    .command("create")
    .requiredOption("--scope <s>", "personal|project|team")
    .option("--project <id>", "scope=project일 때 필요")
    .option("--team <id>", "scope=team일 때 필요")
    .option("--label <text>", "식별용 라벨(선택)")
    .option("--expires-in <days>", "만료까지 일수(선택, 양의 정수 - 지정하지 않으면 배제 전까지 무기한)")
    .action((opts) =>
      run(async () => {
        let expiresAt: string | undefined;
        if (opts.expiresIn !== undefined) {
          const days = Number(opts.expiresIn);
          if (!Number.isInteger(days) || days <= 0) throw new Error("--expires-in은 양의 정수(일수)여야 합니다");
          expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        }
        const result = await apiCall<{ key: unknown; secret: string }>(
          opts.scope === "project"
            ? `/api/projects/${opts.project}/api-keys`
            : opts.scope === "team"
              ? `/api/teams/${opts.team}/api-keys`
              : "/api/api-keys/personal",
          { method: "POST", body: JSON.stringify({ label: opts.label, expiresAt }) },
        );
        printJson(result.key);
        console.log(`\n⚠ 이 값은 지금 한 번만 표시됩니다 - 안전한 곳에 저장하세요:\n${result.secret}\n`);
      }),
    );

  keyCmd
    .command("list")
    .option("--project <id>")
    .option("--team <id>")
    .option("--mine", "개인 키(전체 프로젝트 접근) 목록")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        if (opts.project) { printJson(await apiCall(`/api/projects/${opts.project}/api-keys${paged ? "/page" : ""}${qs}`)); return; }
        if (opts.team) { printJson(await apiCall(`/api/teams/${opts.team}/api-keys${paged ? "/page" : ""}${qs}`)); return; }
        if (opts.mine) { printJson(await apiCall(`/api/api-keys/personal${paged ? "/page" : ""}${qs}`)); return; }
        throw new Error("--project <id> | --team <id> | --mine 중 하나가 필요합니다");
      }),
    );

  keyCmd
    .command("revoke <keyId>")
    .action((keyId) => run(async () => printJson(await apiCall(`/api/api-keys/${keyId}`, { method: "DELETE" }))));

  const credCmd = program.command("credential").description("git 자격증명 관리");

  credCmd
    .command("add")
    .requiredOption("--type <t>", "token|username_password|ssh_key")
    .requiredOption("--value <v>")
    .option("--host <pattern>")
    .action((opts) =>
      run(async () => {
        printJson(
          await apiCall("/api/credentials", {
            method: "POST",
            body: JSON.stringify({ credentialType: opts.type, value: opts.value, hostPattern: opts.host }),
          }),
        );
      }),
    );

  credCmd
    .command("list")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/credentials${paged ? "/page" : ""}${qs}`));
      }),
    );

  credCmd
    .command("remove <id>")
    .action((id) => run(async () => printJson(await apiCall(`/api/credentials/${id}`, { method: "DELETE" }))));
}
