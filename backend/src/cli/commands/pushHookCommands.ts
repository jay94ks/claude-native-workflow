// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git push
// 훅 프롬프트 자동화(대기열 방식, Phase 3). cli/index.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerPushHookCommands(program: Command): void {
  const hookCmd = program.command("hook").description("git push 훅 프롬프트 자동화(대기열)");

  hookCmd
    .command("create <projectId>")
    .requiredOption("--prompt <file>", "프롬프트 내용이 담긴 로컬 파일")
    .option("--branch <branch>", '이 브랜치로 push될 때만 매칭(생략하면 모든 브랜치) - "release/*"처럼 *로 브랜치 그룹을 묶을 수 있다(세그먼트 안에서만 - /는 안 넘음)')
    .action((projectId, opts) =>
      run(async () => {
        const fs = await import("node:fs");
        const promptTemplate = fs.readFileSync(opts.prompt, "utf-8");
        printJson(
          await apiCall(`/api/projects/${projectId}/push-hook-prompts`, {
            method: "POST",
            body: JSON.stringify({ promptTemplate, triggerBranch: opts.branch }),
          }),
        );
      }),
    );

  hookCmd
    .command("list <projectId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts${paged ? "/page" : ""}${qs}`));
      }),
    );

  hookCmd
    .command("update <projectId> <id>")
    .option("--prompt <file>", "새 프롬프트 내용이 담긴 로컬 파일(생략하면 기존 내용 유지)")
    .option("--branch <branch>", '새 트리거 브랜치("release/*"처럼 *로 그룹 매칭 가능, --branch="" 처럼 빈 문자열을 주면 브랜치 제한 해제 - 모든 브랜치 매칭, 생략하면 기존 값 유지 - 공백으로 띄어 쓴 --branch ""는 셸/commander가 값 누락으로 처리하니 반드시 =로 붙여 쓸 것)')
    .action((projectId, id, opts) =>
      run(async () => {
        const body: { promptTemplate?: string; triggerBranch?: string } = {};
        if (opts.prompt !== undefined) {
          const fs = await import("node:fs");
          body.promptTemplate = fs.readFileSync(opts.prompt, "utf-8");
        }
        if (opts.branch !== undefined) body.triggerBranch = opts.branch;
        printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts/${id}`, { method: "PUT", body: JSON.stringify(body) }));
      }),
    );

  hookCmd
    .command("delete <projectId> <id>")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts/${id}`, { method: "DELETE" }))),
    );

  hookCmd
    .command("queue <projectId>")
    .option("--status <s>", "pending|acknowledged|done|expired(생략하면 전체) - pending으로 30일 넘게 방치된 항목은 자동으로 expired 처리됨")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = new URLSearchParams({
        ...(opts.status ? { status: opts.status } : {}),
        ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
      });
      const suffix = paged ? "/page" : "";
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-queue${suffix}${qs.toString() ? `?${qs}` : ""}`)));
    });

  hookCmd
    .command("ack <projectId> <id>")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-queue/${id}/ack`, { method: "POST" }))),
    );

  hookCmd
    .command("done <projectId> <id>")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-queue/${id}/done`, { method: "POST" }))),
    );
}
