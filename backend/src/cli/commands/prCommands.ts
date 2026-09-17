// 배치 2d(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - Pull
// Request + 코드 리뷰(사후 검토). cli/index.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜. 둘 다 git 저장소의 "머지 이후" 흐름과 밀접해
// 한 파일로 묶었다.
//
// git 저장소 관리 기능(브랜치 목록/저장소 연동/발행 등)은 지금까지
// 웹 전용이었지만, PR은 이번에 CLI/MCP를 예외로 연다 - 자동 머지가
// 실패했을 때 AI(Claude)가 CLI로 직접 진단하고 수동 병합까지 완료할
// 수 있어야 하기 때문(설계자 요구사항 4번). PR 생성은 브랜치 선택
// UI와 강하게 결합돼 있어 여전히 웹에서만 한다.
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerPrCommands(program: Command): void {
  const prCmd = program.command("pr").description("Pull Request 조회/처리(생성은 웹 저장소 관리 탭에서만)");

  prCmd
    .command("list <projectId>")
    .option("--state <s>", "open|closed|all(기본)")
    .option("--page <n>")
    .option("--count <n>")
    .action((projectId, opts) =>
      run(async () => {
        const qs = new URLSearchParams();
        if (opts.state) qs.set("state", opts.state);
        const paged = opts.page !== undefined || opts.count !== undefined;
        if (paged) {
          qs.set("page", opts.page ?? "1");
          qs.set("pageSize", opts.count ?? "20");
        }
        printJson(await apiCall(`/api/projects/${projectId}/git/pulls${paged ? "/page" : ""}?${qs}`));
      }),
    );

  prCmd
    .command("get <projectId> <index>")
    .action((projectId, index) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}`))));

  prCmd
    .command("commits <projectId> <index>")
    .action((projectId, index) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/commits`))));

  prCmd
    .command("comments <projectId> <index>")
    .action((projectId, index) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/comments`))));

  prCmd
    .command("add-comment <projectId> <index> <body>")
    .description("설계자간 대화(Markdown)에 댓글을 남긴다")
    .action((projectId, index, body) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/pulls/${index}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
          }),
        ),
      ),
    );

  prCmd
    .command("timeline <projectId> <index>")
    .description("PR이 닫힐 때까지의 전체 진행 내역")
    .action((projectId, index) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/timeline`))));

  prCmd
    .command("messages <projectId> <index>")
    .description("이 PR에 대해 기록된 이 앱의 메시지(머지/거부/닫힘/재오픈 등)")
    .action((projectId, index) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/messages`))));

  prCmd
    .command("merge <projectId> <index>")
    .description("자동 머지 - 실패하면 lastMergeError가 기록되고 수동 병합 안내가 뜬다(owner 전용)")
    .action((projectId, index) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/merge`, { method: "POST" }))),
    );

  prCmd
    .command("merge-manually <projectId> <index> <mergeCommitId>")
    .description("자동 머지가 실패했을 때, 로컬에서 직접(또는 AI가) 충돌을 해결해 push한 커밋을 병합 완료로 기록한다(owner 전용)")
    .action((projectId, index, mergeCommitId) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/pulls/${index}/merge-manually`, {
            method: "POST",
            body: JSON.stringify({ mergeCommitId }),
          }),
        ),
      ),
    );

  prCmd
    .command("reject <projectId> <index>")
    .description("PR을 거부한다(이후 재오픈+새 커밋으로 다시 Accept까지 갈 수 있음)")
    .action((projectId, index) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/reject`, { method: "POST" }))),
    );

  prCmd
    .command("close <projectId> <index>")
    .description("머지/거부 여부와 무관하게 닫는다(둘 다 선택 안 했으면 거부로 처리됨)")
    .action((projectId, index) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/close`, { method: "POST" }))),
    );

  prCmd
    .command("reopen <projectId> <index>")
    .action((projectId, index) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/pulls/${index}/reopen`, { method: "POST" }))),
    );

  // 코드 리뷰(사후 검토) - 머지를 막는 게이트가 아니라 이미 반영된
  // 코드를 돌아보는 기록이다(core/codeReview.ts). diff는 리뷰 요청에
  // 딸려있는 base/head를 "docs git compare <projectId> <base> <head>"에
  // 그대로 넘겨 읽는다.
  const codeReviewCmd = program.command("code-review").description("코드 리뷰(사후 검토) - PR/브랜치를 머지 이후 돌아보고 발견(finding)을 남긴다");

  codeReviewCmd
    .command("request <projectId>")
    .description('요청 - "--pr"만 주면 그 PR의 head/base 브랜치를 자동으로 찾는다, 임의 범위를 보려면 --base/--head 직접 지정. diff는 "docs git compare"로 확인')
    .option("--pr <index>", "이 PR과 연관지어 요청(base/head 생략 시 PR의 브랜치를 그대로 씀)")
    .option("--base <ref>", "비교 기준 브랜치/커밋")
    .option("--head <ref>", "비교 대상 브랜치/커밋")
    .requiredOption("--label <text>", "사람이 읽을 대상 설명 - \"PR#12 머지\", \"main 최근 7일\" 등")
    .action((projectId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/code-review/request`, {
            method: "POST",
            body: JSON.stringify({
              prIndex: opts.pr !== undefined ? Number(opts.pr) : undefined,
              base: opts.base,
              head: opts.head,
              label: opts.label,
            }),
          }),
        ),
      ),
    );

  codeReviewCmd
    .command("pending <projectId>")
    .description("AI 분석 대기 중인 리뷰 목록")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/code-review/pending`))));

  codeReviewCmd
    .command("list <projectId>")
    .description("리뷰 이력 조회(상태 무관, 최신순) - --pr을 주면 그 PR에 달린 것만")
    .option("--pr <index>")
    .action((projectId, opts) =>
      run(async () => {
        const qs = opts.pr !== undefined ? `?prIndex=${Number(opts.pr)}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/git/code-review${qs}`));
      }),
    );

  codeReviewCmd
    .command("get <projectId> <reviewId>")
    .action((projectId, reviewId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/code-review/${reviewId}`))));

  codeReviewCmd
    .command("submit <projectId> <reviewId> <file>")
    .description('로컬 JSON 파일({ aiSummary?, findings: [...] })을 제출한다 - findings 항목: filePath/line?/category/severity(blocker|major|minor|nit)/summary/failureScenario/verdict?. blocker는 PN, major는 칸반 카드가 자동 생성된다')
    .action((projectId, reviewId, file) =>
      run(async () => {
        const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
        printJson(
          await apiCall(`/api/projects/${projectId}/git/code-review/${reviewId}/submit`, {
            method: "POST",
            body: JSON.stringify(payload),
          }),
        );
      }),
    );

  codeReviewCmd
    .command("resolve-finding <projectId> <findingId> <status>")
    .description("status는 fixed|wontfix|false_positive 중 하나")
    .option("--comment <text>", "상태 전환과 함께 판단 근거를 코멘트로 같이 남긴다(예: false_positive라고 본 이유)")
    .action((projectId, findingId, status, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/code-review/findings/${findingId}/resolve`, {
            method: "POST",
            body: JSON.stringify({ status, comment: opts.comment }),
          }),
        ),
      ),
    );

  codeReviewCmd
    .command("comment-add <projectId> <reviewId> <body>")
    .description("리뷰(또는 --finding 지정 시 그 발견 항목)에 코멘트를 남긴다 - 수정/삭제 불가(불변 기록)")
    .option("--finding <findingId>", "이 발견 항목에 달기(생략 시 리뷰 전체 코멘트)")
    .action((projectId, reviewId, body, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/code-review/${reviewId}/comments`, {
            method: "POST",
            body: JSON.stringify({ body, findingId: opts.finding }),
          }),
        ),
      ),
    );

  codeReviewCmd
    .command("file-history <projectId> <filePath>")
    .description("이 파일이 과거 리뷰에서 걸렸던 발견(+코멘트) 이력을 최신순으로 조회 - 새 리뷰를 시작하기 전 참고용")
    .option("--line <n>", "그 라인에 걸린 것만(정확히 일치)")
    .action((projectId, filePath, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ path: filePath });
        if (opts.line !== undefined) qs.set("line", String(Number(opts.line)));
        printJson(await apiCall(`/api/projects/${projectId}/git/code-review/file-history?${qs}`));
      }),
    );

  codeReviewCmd
    .command("delete <projectId> <reviewId>")
    .description("발견 항목이 0건인 리뷰만 삭제(취소) 가능 - 하나라도 있으면 거부됨")
    .action((projectId, reviewId) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/code-review/${reviewId}`, { method: "DELETE" }))),
    );
}
