// 배치 2m(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git 파일
// 조회/직접 쓰기(tree/cat/read/grep/cat-batch/put/delete - 스테이징을
// 거치지 않는 단일/일괄 커밋). cli/index.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜. gitRepoCommands.ts가 만든 gitCmd("git" 최상위 명령)를
// 넘겨받아 이어 등록한다.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerGitFileCommands(gitCmd: Command): void {
  gitCmd
    .command("tree <projectId>")
    .option("--path <path>", "디렉터리 경로(생략하면 루트)", "")
    .option("--ref <ref>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = new URLSearchParams({
        path: opts.path,
        ...(opts.ref ? { ref: opts.ref } : {}),
        ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
      });
      const suffix = paged ? "/page" : "";
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/tree${suffix}?${qs}`)));
    });

  gitCmd
    .command("cat <projectId> <path>")
    .option("--ref <ref>")
    .action((projectId, path, opts) => {
      const qs = new URLSearchParams({ path, ...(opts.ref ? { ref: opts.ref } : {}) });
      return run(async () => {
        const file = await apiCall<{ content: string }>(`/api/projects/${projectId}/git/file?${qs}`);
        console.log(file.content);
      });
    });

  gitCmd
    .command("read <projectId> <path>")
    .description("소스 코드 파일을 줄 단위로 부분 읽기(큰 파일을 전체로 안 올리고 필요한 범위만) - 둘 다 생략하면 처음 2000줄")
    .option("--ref <ref>")
    .option("--offset <n>", "시작 줄 번호(1부터)")
    .option("--limit <n>", "최대 줄 수")
    .action((projectId, path, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ path });
        if (opts.ref) qs.set("ref", opts.ref);
        if (opts.offset !== undefined) qs.set("offset", opts.offset);
        if (opts.limit !== undefined) qs.set("limit", opts.limit);
        printJson(await apiCall(`/api/projects/${projectId}/git/file/lines?${qs}`));
      }),
    );

  gitCmd
    .command("grep <projectId> <path> <pattern>")
    .description("소스 코드 파일을 정규식(POSIX ERE)으로 줄 단위 검색 - 매치된 줄 번호+텍스트 배열, 패턴이 잘못되면 에러")
    .option("--ref <ref>")
    .option("--case-insensitive", "대소문자 구분 안 함")
    .option("--context <n>", "매치된 줄 앞뒤로 n줄씩 더 포함(grep -C와 동일)")
    .action((projectId, path, pattern, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ path, q: pattern });
        if (opts.ref) qs.set("ref", opts.ref);
        if (opts.caseInsensitive) qs.set("caseInsensitive", "true");
        if (opts.context !== undefined) qs.set("context", opts.context);
        printJson(await apiCall(`/api/projects/${projectId}/git/file/grep?${qs}`));
      }),
    );

  gitCmd
    .command("put <projectId> <path> <localFile>")
    .option("--message <m>", "커밋 메시지")
    .action((projectId, path, localFile, opts) =>
      run(async () => {
        const fs = await import("node:fs");
        // 이 로컬 파일을 실제 git add/commit으로 올리는 게 아니라 API로
        // 바이트를 그대로 전송하는 경로라, Windows에서 core.autocrlf=true로
        // 체크아웃된 파일(CRLF)을 그대로 읽으면 진짜 git이 커밋 시점에
        // 해주는 CRLF→LF 정규화를 못 받는다 - 저장소 원본(GitHub 등)이
        // LF인 파일도 이 경로로 올리면 조용히 CRLF로 오염된다(#sync-status-crlf-fix
        // 라운드에서 실측 확인 - 같은 파일의 mirror/work 블롭 sha가
        // 계속 달라 보이던 진짜 원인). 이 파이프라인은 처음부터 UTF-8
        // 텍스트 전용(Buffer.from(content, "utf-8")로 그대로 전송)이라
        // 바이너리 파일은 애초에 대상이 아니므로, 실제 git과 동일하게
        // 여기서 CRLF를 LF로 정규화한다.
        const content = fs.readFileSync(localFile, "utf-8").replace(/\r\n/g, "\n");
        const qs = new URLSearchParams({ path });
        printJson(
          await apiCall(`/api/projects/${projectId}/git/file?${qs}`, {
            method: "PUT",
            body: JSON.stringify({ content, message: opts.message }),
          }),
        );
      }),
    );

  gitCmd
    .command("delete <projectId> <path>")
    .description("저장소에서 파일을 삭제한다(커밋으로 기록됨)")
    .option("--message <m>", "커밋 메시지")
    .action((projectId, path, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ path });
        printJson(
          await apiCall(`/api/projects/${projectId}/git/file?${qs}`, {
            method: "DELETE",
            body: JSON.stringify({ message: opts.message }),
          }),
        );
      }),
    );

  gitCmd
    .command("cat-batch <projectId> <paths>")
    .description("여러 파일을 한 번에 조회한다(쉼표로 구분한 경로 목록)")
    .action((projectId, paths) =>
      run(async () => {
        const qs = new URLSearchParams({ paths });
        printJson(await apiCall(`/api/projects/${projectId}/git/files?${qs}`));
      }),
    );
}
