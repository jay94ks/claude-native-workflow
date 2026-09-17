// 배치 2l(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 템플릿
// (CLAUDE.md, SKILL.md 등). cli/index.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import fs from "node:fs";
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerTemplateCommands(program: Command): void {
  const templateCmd = program.command("template").description("CLAUDE.md/SKILL.md 템플릿 관리");

  templateCmd
    .command("get <filename>")
    .option("--project <id>", "이 프로젝트 스코프로 resolve(override 체인 적용) - 생략하면 전역 기본값만")
    .action((filename, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ filename, ...(opts.project ? { projectId: opts.project } : {}) });
        printJson(await apiCall(`/api/templates?${qs}`));
      }),
    );

  templateCmd
    .command("set <filename> <file>")
    .option("--project <id>", "이 프로젝트 스코프에 override 설정")
    .option("--group <id>", "이 프로젝트 그룹 스코프에 override 설정")
    .option("--team <id>", "이 팀 스코프에 override 설정")
    .action((filename, file, opts) =>
      run(async () => {
        const content = fs.readFileSync(file, "utf-8");
        const qs = new URLSearchParams({ filename });
        printJson(
          await apiCall(`/api/templates?${qs}`, {
            method: "PUT",
            body: JSON.stringify({
              content,
              teamId: opts.team,
              projectGroupId: opts.group,
              projectId: opts.project,
            }),
          }),
        );
      }),
    );

  templateCmd
    .command("deploy <projectId>")
    .description("CLAUDE.md/SKILL.md를 해석해 이 프로젝트의 내부 Gitea 작업 저장소에 커밋한다 - link-external 프로젝트라면 이것만으로 GitHub/GitLab에 반영되지 않으니 이어서 `docs git publish <projectId>`까지 호출한다")
    .action((projectId) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/templates/deploy`, { method: "POST" }))),
    );

  templateCmd
    .command("revisions <filename>")
    .description("과거에 덮어써진 이전 내용들을 시간순으로 조회 - 실수로 잘못된 내용을 덮어썼을 때 template set으로 되돌리는 데 쓴다")
    .option("--project <id>", "이 프로젝트 스코프의 override 이력")
    .option("--group <id>", "이 프로젝트 그룹 스코프의 override 이력")
    .option("--team <id>", "이 팀 스코프의 override 이력")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((filename, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = new URLSearchParams({
          filename,
          ...(opts.team ? { teamId: opts.team } : {}),
          ...(opts.group ? { projectGroupId: opts.group } : {}),
          ...(opts.project ? { projectId: opts.project } : {}),
          ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
        });
        printJson(await apiCall(`/api/templates/revisions${paged ? "/page" : ""}?${qs}`));
      }),
    );
}
