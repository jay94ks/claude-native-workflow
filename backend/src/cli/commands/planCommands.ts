// 배치 2j(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 보류
// 계획(PN). cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// Document/DocType/DocStatus 체계와 완전히 별도로 관리되는 독립
// 엔티티(core/plans.ts 참고) - Claude가 작업 중 "이건 나중에 따로
// 계획을 잡아야 한다"고 판단한 항목을 모아두는 체크리스트.
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerPlanCommands(program: Command): void {
  const planCmd = program.command("plan").description("별도 계획이 필요한 항목 체크리스트 - 문서와 별개 체계, 상태는 5개 고정");

  planCmd
    .command("new <projectId> <title>")
    .description("계획을 새로 만든다")
    .requiredOption("--body <file>", "본문(Markdown) 파일 경로")
    .option("--status <code>", "초기 상태(생략 시 planned) - planned|pending_approval|in_review|scheduled|completed|rejected")
    .option("--refs <codes>", "쉼표로 구분된 관련 문서 trackingCode 목록")
    .option("--depends-on <codes>", "쉼표로 구분된 선행 조건 계획 trackingCode 목록")
    .action((projectId, title, opts) =>
      run(async () => {
        const body = fs.readFileSync(opts.body, "utf-8");
        printJson(
          await apiCall(`/api/projects/${projectId}/plans`, {
            method: "POST",
            body: JSON.stringify({
              title,
              body,
              status: opts.status,
              refs: opts.refs ? String(opts.refs).split(",").filter(Boolean) : undefined,
              dependsOn: opts.dependsOn ? String(opts.dependsOn).split(",").filter(Boolean) : undefined,
            }),
          }),
        );
      }),
    );

  planCmd
    .command("list <projectId>")
    .description("이 프로젝트의 계획 목록(기본 본문 제외 - 문서 목록과 같은 관례, --full로 전체) - 기본 정렬은 의존도(선행 조건 개수)가 가장 낮은 순(지금 바로 시작할 수 있는 계획이 위로)")
    .option("--status <code>", "상태로 제한")
    .option("--q <text>", "제목/본문 검색어")
    .option("--page <n>", "페이지 번호(1부터, 기본 1)")
    .option("--count <n>", "페이지당 개수(기본 20)")
    .option("--sort <key>", "dependencyCount:asc(기본) 또는 updatedAt:desc")
    .option("--full", "본문까지 포함(기본은 요약만 - 본문이 필요하면 이 플래그 또는 plan get으로 이어서 조회)")
    .action((projectId, opts) =>
      run(async () => {
        const qs = new URLSearchParams({
          ...(opts.status ? { status: opts.status } : {}),
          ...(opts.q ? { q: opts.q } : {}),
          page: opts.page ?? "1",
          pageSize: opts.count ?? "20",
          ...(opts.sort ? { sort: opts.sort } : {}),
          ...(opts.full ? { full: "true" } : {}),
        });
        printJson(await apiCall(`/api/projects/${projectId}/plans?${qs}`));
      }),
    );

  planCmd
    .command("statuses")
    .description("계획 상태로 쓸 수 있는 코드/라벨 목록(고정값)")
    .action(() => run(async () => printJson(await apiCall(`/api/plans/statuses`))));

  planCmd
    .command("get <trackingCode>")
    .description("계획 상세(관련 문서 포함)")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/plans/${trackingCode}`))));

  planCmd
    .command("set <trackingCode>")
    .description("제목/본문을 수정한다(둘 중 준 것만 바뀜)")
    .option("--title <t>")
    .option("--body <file>", "본문(Markdown) 파일 경로")
    .action((trackingCode, opts) =>
      run(async () => {
        const body: Record<string, unknown> = {};
        if (opts.title !== undefined) body.title = opts.title;
        if (opts.body !== undefined) {
          body.body = fs.readFileSync(opts.body, "utf-8");
        }
        printJson(await apiCall(`/api/plans/${trackingCode}`, { method: "PUT", body: JSON.stringify(body) }));
      }),
    );

  planCmd
    .command("status <trackingCode> <status>")
    .description("계획 상태를 바꾼다 - planned|pending_approval|in_review|scheduled|completed|rejected 중 하나(전이 제약 없음)")
    .action((trackingCode, status) =>
      run(async () => printJson(await apiCall(`/api/plans/${trackingCode}/status`, { method: "PUT", body: JSON.stringify({ status }) }))),
    );

  planCmd
    .command("delete <trackingCode>")
    .description("계획을 삭제한다")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/plans/${trackingCode}`, { method: "DELETE" }))));

  planCmd
    .command("link <trackingCode> <docTrackingCode>")
    .description("계획에 관련 문서를 추가한다")
    .action((trackingCode, docTrackingCode) =>
      run(async () =>
        printJson(
          await apiCall(`/api/plans/${trackingCode}/refs`, { method: "POST", body: JSON.stringify({ trackingCode: docTrackingCode }) }),
        ),
      ),
    );

  planCmd
    .command("depend <trackingCode> <dependsOnTrackingCode>")
    .description("계획에 선행 조건(먼저 끝나야 하는 다른 계획)을 추가한다 - 여러 개 가능, 하나씩 호출")
    .action((trackingCode, dependsOnTrackingCode) =>
      run(async () =>
        printJson(
          await apiCall(`/api/plans/${trackingCode}/dependencies`, {
            method: "POST",
            body: JSON.stringify({ trackingCode: dependsOnTrackingCode }),
          }),
        ),
      ),
    );

  planCmd
    .command("undepend <trackingCode> <dependsOnTrackingCode>")
    .description("계획에서 선행 조건을 제거한다")
    .action((trackingCode, dependsOnTrackingCode) =>
      run(async () =>
        printJson(await apiCall(`/api/plans/${trackingCode}/dependencies/${dependsOnTrackingCode}`, { method: "DELETE" })),
      ),
    );

  planCmd
    .command("unlink <trackingCode> <docTrackingCode>")
    .description("계획에서 관련 문서를 제거한다")
    .action((trackingCode, docTrackingCode) =>
      run(async () => printJson(await apiCall(`/api/plans/${trackingCode}/refs/${docTrackingCode}`, { method: "DELETE" }))),
    );

  planCmd
    .command("bulk-export <projectId> <outFile>")
    .description("이 프로젝트의 계획을 조건에 맞는 전체(페이지 상한 없음) 하나의 로컬 JSON 파일로 내보낸다 - 기본 정렬은 의존도가 가장 낮은 순")
    .option("--status <code>", "상태로 제한")
    .option("--q <text>", "제목/본문 검색어")
    .option("--sort <key>", "dependencyCount:asc(기본) 또는 updatedAt:desc")
    .action((projectId, outFile, opts) =>
      run(async () => {
        const qs = new URLSearchParams({
          ...(opts.status ? { status: opts.status } : {}),
          ...(opts.q ? { q: opts.q } : {}),
          ...(opts.sort ? { sort: opts.sort } : {}),
        });
        const plans = await apiCall(`/api/projects/${projectId}/plans/export?${qs}`);
        fs.writeFileSync(outFile, JSON.stringify(plans, null, 2), "utf-8");
        console.log(`${(plans as unknown[]).length}개 계획을 ${outFile}에 썼습니다.`);
      }),
    );

  planCmd
    .command("bulk-import <projectId> <file>")
    .description("로컬 JSON 파일(항목 배열: title/body/status?/refs?/dependsOn?)로 여러 계획을 한 번에 만든다 - 항목별 성공/실패 반환(부분 성공 허용). refs/dependsOn은 이미 존재하는 문서/계획만 가리킬 수 있다(같은 파일 안 다른 항목은 불가)")
    .action((projectId, file) =>
      run(async () => {
        const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
        printJson(await apiCall(`/api/projects/${projectId}/plans/import`, { method: "POST", body: JSON.stringify({ items }) }));
      }),
    );

  planCmd
    .command("status-bulk <status> <trackingCodes...>")
    .description("여러 계획을 한 번에 같은 상태로 바꾼다 - 항목별 결과를 반환(일부만 실패해도 나머지는 계속 진행)")
    .action((status, trackingCodes) =>
      run(async () =>
        printJson(await apiCall(`/api/plans/bulk-status`, { method: "POST", body: JSON.stringify({ trackingCodes, status }) })),
      ),
    );

  planCmd
    .command("link-bulk <docTrackingCode> <trackingCodes...>")
    .description("여러 계획에 같은 관련 문서를 한 번에 추가한다 - 항목별 결과를 반환")
    .action((docTrackingCode, trackingCodes) =>
      run(async () =>
        printJson(await apiCall(`/api/plans/bulk-link`, { method: "POST", body: JSON.stringify({ trackingCodes, docTrackingCode }) })),
      ),
    );

  planCmd
    .command("depend-bulk <dependsOnTrackingCode> <trackingCodes...>")
    .description("여러 계획에 같은 선행 조건을 한 번에 추가한다 - 항목별 결과를 반환")
    .action((dependsOnTrackingCode, trackingCodes) =>
      run(async () =>
        printJson(
          await apiCall(`/api/plans/bulk-depend`, { method: "POST", body: JSON.stringify({ trackingCodes, dependsOnTrackingCode }) }),
        ),
      ),
    );
}
