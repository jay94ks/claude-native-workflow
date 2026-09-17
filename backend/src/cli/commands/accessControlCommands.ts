// 배치 2i(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 세부
// 접근 권한. cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerAccessControlCommands(program: Command): void {
  program
    .command("access-set <projectId> <userId>")
    .option("--doctype <id>", "문서 타입 스코프(문서/스코프 중 하나만)")
    .option("--document <trackingCode>", "개별 문서 스코프")
    .option("--read <bool>", "true|false")
    .option("--write <bool>", "true|false")
    .option("--delete <bool>", "true|false")
    .action((projectId, userId, opts) =>
      run(async () => {
        const patch = {
          userId,
          canRead: opts.read !== undefined ? opts.read === "true" : undefined,
          canWrite: opts.write !== undefined ? opts.write === "true" : undefined,
          canDelete: opts.delete !== undefined ? opts.delete === "true" : undefined,
        };
        if (opts.document) {
          printJson(
            await apiCall(`/api/documents/${opts.document}/access`, { method: "PUT", body: JSON.stringify(patch) }),
          );
        } else if (opts.doctype) {
          printJson(
            await apiCall(`/api/projects/${projectId}/doc-types/${opts.doctype}/access`, {
              method: "PUT",
              body: JSON.stringify(patch),
            }),
          );
        } else {
          printJson(await apiCall(`/api/projects/${projectId}/access`, { method: "PUT", body: JSON.stringify(patch) }));
        }
      }),
    );

  program
    .command("access-list <projectId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/access${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("access-overview")
    .description("내가 전체 설치에서 어떤 접근 제한을 받고 있는지 프로젝트를 가로질러 한 번에 조회")
    .action(() => run(async () => printJson(await apiCall("/api/auth/me/access-overview"))));
}
