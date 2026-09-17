// 배치 2m(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git 저장소
// 연결/이력 조회(연결/해제/동기화/발행/로그/diff/blame/show/토큰). cli/
// index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. tree/cat/read/
// grep/put/delete/cat-batch는 gitFileCommands.ts로, staging(add/rm/
// commit 등)은 gitStagingCommands.ts로 갈라졌다 - 셋 다 같은 "git" 최상위
// 명령을 공유하므로 이 파일이 gitCmd를 만들어 반환하고 나머지 두 파일이
// 그걸 넘겨받아 이어 등록한다.
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { apiCall, apiCallText } from "../apiclient.js";
import { printJson, run, sleep } from "../shared.js";

export function registerGitRepoCommands(program: Command): Command {
  const gitCmd = program.command("git").description("git 저장소 연결/이력 조회");

  gitCmd
    .command("link <projectId>")
    .option("--import-from <url>", "이 URL의 히스토리를 통째로 가져와 Gitea 저장소로 시작한다(완전 이주, 선택 - 없으면 빈 저장소)")
    .option("--credential <id>", "--import-from이 비공개 저장소일 때 쓸 git 자격증명 id(선택)")
    .description("자체 호스팅(Gitea)에 저장소를 만들고 연결한다(--import-from으로 외부 저장소를 이주해올 수도 있다)")
    .action((projectId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/link`, {
            method: "POST",
            body: JSON.stringify(
              opts.importFrom ? { importFrom: { repoUrl: opts.importFrom, gitCredentialId: opts.credential } } : {},
            ),
          }),
        ),
      ),
    );

  gitCmd
    .command("link-external <projectId>")
    .requiredOption("--provider <p>", "github|gitlab")
    .requiredOption("--url <url>", "기존 저장소 URL")
    .option("--credential <id>", "비공개 저장소 접근 + 자동 웹훅 등록에 쓸 git 자격증명 id(선택)")
    .description(
      "외부 저장소를 주된(authoritative) 저장소로 연동한다 - 관리 편의를 위해 Gitea에 미러(읽기 전용)와 작업 저장소(이 시스템이 커밋하는 곳)를 같이 만든다",
    )
    .action((projectId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/link-external`, {
            method: "POST",
            body: JSON.stringify({ provider: opts.provider, repoUrl: opts.url, gitCredentialId: opts.credential }),
          }),
        ),
      ),
    );

  gitCmd
    .command("repo <projectId>")
    .description("연결된 git 저장소 정보를 조회한다")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/repo`))));

  gitCmd
    .command("unlink <projectId>")
    .description(
      "외부 연동(link-external)의 권위 저장소 관계만 끊는다 - Gitea 작업 저장소는 그대로 남아 self_hosted로 전환된다(자체 호스팅 저장소는 해제 불가 - 프로젝트 삭제만 가능)",
    )
    .action((projectId) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/repo`, { method: "DELETE" }))),
    );

  gitCmd
    .command("sync-status <projectId>")
    .description(
      "외부 연동(link-external) 프로젝트의 미러 대비 작업 저장소 변경 현황을 확인한다 - Gitea의 미러 동기화가 비동기라 요청 후 완료될 때까지 기다렸다가 결과를 출력한다(이미 다른 요청이 진행 중이면 그 결과를 그대로 기다림)",
    )
    .action((projectId) =>
      run(async () => {
        const request = await apiCall<{ status: "scheduled" | "already-scheduled" }>(
          `/api/projects/${projectId}/git/sync-status`,
          { method: "POST" },
        );
        console.error(request.status === "already-scheduled" ? "이미 진행 중인 요청이 있습니다 - 대기합니다..." : "동기화 확인을 요청했습니다 - 대기합니다...");
        for (;;) {
          const state = await apiCall<{ status: "none" | "pending" | "ready"; added?: string[]; changed?: string[]; removedFromWork?: string[] }>(
            `/api/projects/${projectId}/git/sync-status`,
          );
          if (state.status === "ready") {
            printJson(state);
            return;
          }
          await sleep(1500);
        }
      }),
    );

  gitCmd
    .command("sync-proposal <projectId>")
    .option("--out <dir>", "달라진 파일들을 이 로컬 디렉터리에 그대로 써준다(생략하면 JSON으로만 출력)")
    .description("외부 연동 프로젝트에서 달라진 파일 내용을 내보낸다 - 직접 커밋·PR로 반영하는 건 설계자 몫")
    .action((projectId, opts) =>
      run(async () => {
        const proposal = await apiCall<{ files: { path: string; content: string }[] }>(
          `/api/projects/${projectId}/git/sync-proposal`,
        );
        if (!opts.out) {
          printJson(proposal);
          return;
        }
        for (const file of proposal.files) {
          const target = path.join(opts.out, file.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, file.content, "utf-8");
        }
        console.log(`${proposal.files.length}개 파일을 ${opts.out}에 썼습니다.`);
      }),
    );

  gitCmd
    .command("publish <projectId>")
    .requiredOption("--credential <id>", "쓸 git 자격증명 id(docs credential list로 확인)")
    .description("외부(권위) 저장소로 실제 동기화(push)를 시도한다 - 즉시 반영되면 status:synced, fast-forward 불가/권한 부족이면 status:queued로 AI 대기열에 올라감")
    .action((projectId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/publish`, {
            method: "POST",
            body: JSON.stringify({ gitCredentialId: opts.credential }),
          }),
        ),
      ),
    );

  gitCmd
    .command("publish-queue <projectId>")
    .description("이 프로젝트의 처리 대기 중인 발행 큐 항목을 조회한다(없으면 null)")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/publish-queue`))));

  gitCmd
    .command("publish-queue-done <projectId> <id>")
    .description("발행 큐 항목 처리를 완료로 보고한다 - 그래야 웹 UI의 동기화 버튼이 다시 활성화된다")
    .action((projectId, id) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/publish-queue/${id}/done`, { method: "POST" }))),
    );

  gitCmd
    .command("log <projectId>")
    .option("--ref <ref>", "브랜치/커밋 ref(생략하면 기본 브랜치)")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답을 받는다(Gitea 제약으로 total은 없음, hasMore만), 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = new URLSearchParams({
        ...(opts.ref ? { ref: opts.ref } : {}),
        ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
      });
      const suffix = paged ? "/page" : "";
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/log${suffix}${qs.toString() ? `?${qs}` : ""}`)));
    });

  gitCmd
    .command("diff <projectId> <sha>")
    .action((projectId, sha) => run(async () => console.log(await apiCallText(`/api/projects/${projectId}/git/diff/${sha}`))));

  gitCmd
    .command("compare <projectId> <base> <head>")
    .description("커밋 하나가 아니라 base..head 사이 전체 diff - 코드 리뷰(사후 검토)가 근거하는 명령")
    .action((projectId, base, head) =>
      run(async () => {
        const qs = new URLSearchParams({ base, head });
        console.log(await apiCallText(`/api/projects/${projectId}/git/compare?${qs}`));
      }),
    );

  gitCmd
    .command("blame <projectId> <path>")
    .option("--ref <ref>")
    .action((projectId, path, opts) => {
      const qs = new URLSearchParams({ path, ...(opts.ref ? { ref: opts.ref } : {}) });
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/blame?${qs}`)));
    });

  gitCmd
    .command("show <projectId> <sha>")
    .action((projectId, sha) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/show/${sha}`))));

  // my-token은 gitStagingCommands.ts 맨 끝에 등록한다(이 파일에서 등록하면
  // `docs git --help` 목록에서 tree/cat/put 등보다 위에 뜨게 되어 원래
  // index.ts 시절의 순서 - 모든 git 하위 명령 중 맨 마지막 - 와 달라짐,
  // 셋으로 쪼갠 파일 중 registerGitStagingCommands가 index.ts에서 제일
  // 나중에 호출되므로 거기 두면 원래 순서가 그대로 보존된다).

  return gitCmd;
}
