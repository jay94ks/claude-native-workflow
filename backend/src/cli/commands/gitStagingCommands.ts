// 배치 2m(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - git
// 스테이징 워크플로우(add/rm/add-bulk/rm-bulk/status/restore/commit).
// cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. gitRepoCommands.ts가
// 만든 gitCmd("git" 최상위 명령)를 넘겨받아 이어 등록한다.
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerGitStagingCommands(gitCmd: Command): void {
  gitCmd
    .command("add <projectId> <path> <localFile>")
    .description("파일 변경을 스테이징한다(git add - 아직 커밋 안 됨)")
    .action((projectId, path, localFile) =>
      run(async () => {
        const fs = await import("node:fs");
        // git put과 같은 이유로 CRLF→LF 정규화(위 put 명령 주석 참고).
        const content = fs.readFileSync(localFile, "utf-8").replace(/\r\n/g, "\n");
        printJson(
          await apiCall(`/api/projects/${projectId}/git/staging/add`, {
            method: "POST",
            body: JSON.stringify({ path, content }),
          }),
        );
      }),
    );

  gitCmd
    .command("rm <projectId> <path>")
    .description("파일 삭제를 스테이징한다(git rm - 아직 커밋 안 됨)")
    .action((projectId, path) =>
      run(async () => {
        printJson(
          await apiCall(`/api/projects/${projectId}/git/staging/rm`, {
            method: "POST",
            body: JSON.stringify({ path }),
          }),
        );
      }),
    );

  // 파일마다 add를 한 건씩 반복 호출하면 여러 파일을 다뤄야 할 때 느리게
  // 체감된다(CLI 프로세스 기동+HTTP 왕복이 파일 수만큼 누적) - 로컬 JSON
  // 매니페스트({path, localFile} 항목 배열, docs relation add-bulk와 같은
  // "로컬 파일 참조 배열" 관례)로 여러 파일을 한 번에 스테이징한다.
  gitCmd
    .command("add-bulk <projectId> <manifestFile>")
    .description("로컬 JSON 매니페스트([{path, localFile}, ...])로 여러 파일 변경을 한 번에 스테이징한다(git add 여러 개, 아직 커밋 안 됨)")
    .action((projectId, manifestFile) =>
      run(async () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), "utf-8")) as { path: string; localFile: string }[];
        const items = manifest.map((m) => ({
          path: m.path,
          // git put/add와 같은 이유로 CRLF→LF 정규화.
          content: fs.readFileSync(m.localFile, "utf-8").replace(/\r\n/g, "\n"),
        }));
        printJson(
          await apiCall(`/api/projects/${projectId}/git/staging/add-bulk`, {
            method: "POST",
            body: JSON.stringify({ items }),
          }),
        );
      }),
    );

  gitCmd
    .command("rm-bulk <projectId> <paths...>")
    .description("여러 파일 삭제를 한 번에 스테이징한다(git rm 여러 개, 아직 커밋 안 됨)")
    .action((projectId, paths) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/git/staging/rm-bulk`, {
            method: "POST",
            body: JSON.stringify({ paths }),
          }),
        ),
      ),
    );

  gitCmd
    .command("status <projectId>")
    .description("스테이징된 변경 목록과 각 항목의 현재 HEAD 대비 diff를 조회한다")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/staging/status`))));

  gitCmd
    .command("restore <projectId> <path>")
    .description("스테이징을 취소한다(git restore --staged)")
    .action((projectId, path) =>
      run(async () => {
        printJson(
          await apiCall(`/api/projects/${projectId}/git/staging/restore`, {
            method: "POST",
            body: JSON.stringify({ path }),
          }),
        );
      }),
    );

  gitCmd
    .command("commit <projectId>")
    .description("스테이징된 변경을 전부 모아 한 번에 커밋한다(드리프트가 있으면 3-way 자동 병합, 진짜 충돌이 있으면 전체 커밋 거부)")
    .requiredOption("--message <m>", "커밋 메시지")
    .action((projectId, opts) =>
      run(async () => {
        printJson(
          await apiCall(`/api/projects/${projectId}/git/staging/commit`, {
            method: "POST",
            body: JSON.stringify({ message: opts.message }),
          }),
        );
      }),
    );

  // my-token은 스테이징과 무관한 repo 스코프 명령(Gitea 개인 접근 토큰
  // 재발급)이지만, 원래 index.ts 시절 git 하위 명령 중 맨 마지막으로
  // 선언돼 있던 `docs git --help` 순서를 그대로 보존하려고 셋 중 가장
  // 나중에 등록되는 이 파일 끝에 둔다(gitRepoCommands.ts 참고).
  gitCmd
    .command("my-token")
    .description("내 Gitea 개인 접근 토큰을 재발급하고 1회 노출한다(외부 git 클라이언트에서 clone/push 시 비밀번호 자리에 쓴다)")
    .action(() =>
      run(async () => {
        const result = await apiCall<{ username: string; token: string }>("/api/auth/me/git-token", { method: "POST" });
        console.log("이 값은 지금 한 번만 표시됩니다 - 안전한 곳에 저장하세요.");
        printJson(result);
      }),
    );
}
