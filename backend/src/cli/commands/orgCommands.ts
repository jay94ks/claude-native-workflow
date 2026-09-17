// 배치 2f(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// 팀/그룹/프로젝트/멤버. cli/index.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜. 서로 밀접한 조직 위계라 #58의 orgRoutes.ts와 같은
// 원칙으로 한 파일로 묶었다.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerOrgCommands(program: Command): void {
  program
    .command("team-create <name>")
    .option("--public", "공개 설정(기본 비공개) - 소속되지 않은 설계자에게도 목록에 노출됨")
    .action((name, opts) =>
      run(async () =>
        printJson(await apiCall("/api/teams", { method: "POST", body: JSON.stringify({ name, isPublic: opts.public }) })),
      ),
    );

  program
    .command("teams")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/teams${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("team-update <teamId>")
    .option("--name <n>")
    .option("--enabled <bool>", "true|false")
    .option("--public <bool>", "true|false")
    .action((teamId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/teams/${teamId}`, {
            method: "PUT",
            body: JSON.stringify({
              name: opts.name,
              enabled: opts.enabled === undefined ? undefined : opts.enabled === "true",
              isPublic: opts.public === undefined ? undefined : opts.public === "true",
            }),
          }),
        ),
      ),
    );

  program
    .command("team-delete <teamId>")
    .action((teamId) => run(async () => printJson(await apiCall(`/api/teams/${teamId}`, { method: "DELETE" }))));

  program
    .command("team-members <teamId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((teamId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/teams/${teamId}/members${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("team-admin-add <teamId> <userId>")
    .action((teamId, userId) =>
      run(async () =>
        printJson(await apiCall(`/api/teams/${teamId}/admins`, { method: "POST", body: JSON.stringify({ userId }) })),
      ),
    );

  program
    .command("team-admin-remove <teamId> <userId>")
    .action((teamId, userId) =>
      run(async () => printJson(await apiCall(`/api/teams/${teamId}/admins/${userId}`, { method: "DELETE" }))),
    );

  program
    .command("team-admins <teamId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((teamId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/teams/${teamId}/admins${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("group-create <name>")
    .option("--team <id>")
    .option("--public", "공개 설정(기본 비공개) - 소속되지 않은 설계자에게도 목록에 노출됨")
    .action((name, opts) =>
      run(async () =>
        printJson(
          await apiCall("/api/project-groups", {
            method: "POST",
            body: JSON.stringify({ name, teamId: opts.team, isPublic: opts.public }),
          }),
        ),
      ),
    );

  program
    .command("groups")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/project-groups${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("group-update <groupId>")
    .option("--name <n>")
    .option("--team <id>", "다른 팀으로 재소속(목적지 팀의 팀장만 가능). 팀에서 떼어내려면 --team \"\"")
    .option("--public <bool>", "true|false")
    .action((groupId, opts) =>
      run(async () => {
        if (opts.name === undefined && opts.team === undefined && opts.public === undefined) {
          throw new Error("--name, --team, --public 중 하나는 있어야 합니다");
        }
        printJson(
          await apiCall(`/api/project-groups/${groupId}`, {
            method: "PUT",
            body: JSON.stringify({
              name: opts.name,
              teamId: opts.team,
              isPublic: opts.public === undefined ? undefined : opts.public === "true",
            }),
          }),
        );
      }),
    );

  program
    .command("group-delete <groupId>")
    .action((groupId) => run(async () => printJson(await apiCall(`/api/project-groups/${groupId}`, { method: "DELETE" }))));

  program
    .command("group-members <groupId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((groupId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/project-groups/${groupId}/members${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("group-admin-add <groupId> <userId>")
    .action((groupId, userId) =>
      run(async () =>
        printJson(
          await apiCall(`/api/project-groups/${groupId}/admins`, { method: "POST", body: JSON.stringify({ userId }) }),
        ),
      ),
    );

  program
    .command("group-admin-remove <groupId> <userId>")
    .action((groupId, userId) =>
      run(async () => printJson(await apiCall(`/api/project-groups/${groupId}/admins/${userId}`, { method: "DELETE" }))),
    );

  program
    .command("group-admins <groupId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((groupId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/project-groups/${groupId}/admins${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("project-create <name>")
    .option("--group <id>")
    .option("--public", "공개 설정(기본 비공개) - isPublic이어도 그 그룹에 실제 멤버십이 있는 설계자에게만 보임")
    .action((name, opts) =>
      run(async () =>
        printJson(
          await apiCall("/api/projects", {
            method: "POST",
            body: JSON.stringify({ name, projectGroupId: opts.group, isPublic: opts.public }),
          }),
        ),
      ),
    );

  program
    .command("projects")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/projects${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("project <projectId>")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}`))));

  program
    .command("project-hide <projectId>")
    .requiredOption("--hidden <bool>", "true|false")
    .action((projectId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/hidden`, {
            method: "PUT",
            body: JSON.stringify({ hidden: opts.hidden === "true" }),
          }),
        ),
      ),
    );

  program
    .command("project-public <projectId>")
    .requiredOption("--public <bool>", "true|false")
    .action((projectId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/public`, {
            method: "PUT",
            body: JSON.stringify({ isPublic: opts.public === "true" }),
          }),
        ),
      ),
    );

  program
    .command("project-delete <projectId>")
    .description("프로젝트를 완전히 삭제한다(문서/코멘트/칸반/Q&A/연결된 Gitea 저장소까지 전부 - 되돌릴 수 없음, owner 전용)")
    .action((projectId) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}`, { method: "DELETE" }))),
    );

  program
    .command("member-add <projectId> <userId>")
    .requiredOption("--role <r>", "owner|editor|viewer")
    .action((projectId, userId, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/members`, {
            method: "POST",
            body: JSON.stringify({ userId, role: opts.role }),
          }),
        ),
      ),
    );

  program
    .command("members <projectId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/members${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("member-set-role <projectId> <userId> <role>")
    .action((projectId, userId, role) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/members/${userId}`, {
            method: "PUT",
            body: JSON.stringify({ role }),
          }),
        ),
      ),
    );

  program
    .command("member-remove <projectId> <userId>")
    .action((projectId, userId) =>
      run(async () =>
        printJson(await apiCall(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" })),
      ),
    );
}
