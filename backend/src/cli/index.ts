#!/usr/bin/env node
import { Command } from "commander";
import { apiCall, saveCredentials, loadCredentials, clearCredentials, credentialsPath } from "./apiclient.js";

const program = new Command();
program.name("docs").description("claude-native-workflow v2 문서 워크플로우 CLI").version("0.1.0");

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- 인증

const authCmd = program.command("auth").description("인증");

authCmd
  .command("register")
  .requiredOption("--api <url>", "서버 주소")
  .requiredOption("--username <u>")
  .option("--email <e>")
  .option("--password <p>", "생략하면 CNW_PASSWORD 환경변수를 씀")
  .action((opts) =>
    run(async () => {
      const password = opts.password ?? process.env.CNW_PASSWORD;
      if (!password) throw new Error("--password 또는 CNW_PASSWORD 환경변수가 필요합니다");
      process.env.CNW_API_BASE = opts.api;
      const result = await apiCall("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: opts.username, email: opts.email, password }),
      });
      printJson(result);
      console.log("가입 완료 - docs auth login으로 로그인하세요.");
    }),
  );

authCmd
  .command("login")
  .requiredOption("--api <url>")
  .requiredOption("--username <u>")
  .option("--password <p>")
  .action((opts) =>
    run(async () => {
      const password = opts.password ?? process.env.CNW_PASSWORD;
      if (!password) throw new Error("--password 또는 CNW_PASSWORD 환경변수가 필요합니다");
      process.env.CNW_API_BASE = opts.api;
      const result = await apiCall<{ access_token: string; refresh_token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username_or_email: opts.username, password }),
      });
      saveCredentials({ api_base: opts.api, access_token: result.access_token, refresh_token: result.refresh_token });
      console.log(`로그인 완료 - 토큰을 ${credentialsPath}에 저장했습니다(권한 600).`);
    }),
  );

authCmd.command("logout").action(() =>
  run(async () => {
    const creds = loadCredentials();
    if (creds) {
      await apiCall("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: creds.refresh_token }),
      }).catch(() => {});
    }
    clearCredentials();
    console.log("로그아웃 완료.");
  }),
);

authCmd.command("whoami").action(() =>
  run(async () => {
    const creds = loadCredentials();
    if (!creds) { console.log("로그인되어 있지 않습니다"); return; }
    printJson({ api_base: creds.api_base });
  }),
);

// ---------------------------------------------------------------- git 자격증명

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

credCmd.command("list").action(() => run(async () => printJson(await apiCall("/api/credentials"))));

credCmd
  .command("remove <id>")
  .action((id) => run(async () => printJson(await apiCall(`/api/credentials/${id}`, { method: "DELETE" }))));

// ---------------------------------------------------------------- 기관/그룹/프로젝트

program
  .command("institution-create <name>")
  .action((name) => run(async () => printJson(await apiCall("/api/institutions", { method: "POST", body: JSON.stringify({ name }) }))));

program.command("institutions").action(() => run(async () => printJson(await apiCall("/api/institutions"))));

program
  .command("group-create <name>")
  .option("--institution <id>")
  .action((name, opts) =>
    run(async () =>
      printJson(
        await apiCall("/api/project-groups", {
          method: "POST",
          body: JSON.stringify({ name, institutionId: opts.institution }),
        }),
      ),
    ),
  );

program.command("groups").action(() => run(async () => printJson(await apiCall("/api/project-groups"))));

program
  .command("project-create <name>")
  .option("--group <id>")
  .action((name, opts) =>
    run(async () =>
      printJson(
        await apiCall("/api/projects", { method: "POST", body: JSON.stringify({ name, projectGroupId: opts.group }) }),
      ),
    ),
  );

program.command("projects").action(() => run(async () => printJson(await apiCall("/api/projects"))));

program
  .command("project <projectId>")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}`))));

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
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/members`))));

// ---------------------------------------------------------------- 문서 타입 체계

program
  .command("doctype-create <projectId> <code> <label>")
  .action((projectId, code, label) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types`, { method: "POST", body: JSON.stringify({ code, label }) }),
      ),
    ),
  );

program
  .command("doctypes <projectId>")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/doc-types`))));

// ---------------------------------------------------------------- 문서

program
  .command("new <projectId> <docTypeCode>")
  .requiredOption("--title <t>")
  .requiredOption("--body <file>", "본문 마크다운 파일 경로(로컬 스크래치 사본 - git 커밋 대상 아님)")
  .action((projectId, docTypeCode, opts) =>
    run(async () => {
      const fs = await import("node:fs");
      const body = fs.readFileSync(opts.body, "utf-8");
      printJson(
        await apiCall(`/api/projects/${projectId}/documents`, {
          method: "POST",
          body: JSON.stringify({ docTypeCode, title: opts.title, body }),
        }),
      );
    }),
  );

program
  .command("get <trackingCode>")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}`))));

program
  .command("list <projectId>")
  .option("--type <docTypeId>")
  .action((projectId, opts) =>
    run(async () => {
      const qs = opts.type ? `?docTypeId=${encodeURIComponent(opts.type)}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/documents${qs}`));
    }),
  );

program
  .command("search <projectId> <query>")
  .action((projectId, query) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`))),
  );

program
  .command("save <trackingCode> <file>")
  .action((trackingCode, file) =>
    run(async () => {
      const fs = await import("node:fs");
      const body = fs.readFileSync(file, "utf-8");
      printJson(await apiCall(`/api/documents/${trackingCode}`, { method: "PUT", body: JSON.stringify({ body }) }));
    }),
  );

program
  .command("transition <trackingCode> <toStatusCode>")
  .action((trackingCode, toStatusCode) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${trackingCode}/transition`, {
          method: "POST",
          body: JSON.stringify({ toStatusCode }),
        }),
      ),
    ),
  );

program
  .command("link <fromTrackingCode> <toTrackingCode>")
  .option("--type <linkType>")
  .action((from, to, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${from}/links`, {
          method: "POST",
          body: JSON.stringify({ toTrackingCode: to, linkType: opts.type }),
        }),
      ),
    ),
  );

program
  .command("backlinks <trackingCode>")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/backlinks`))));

// ---------------------------------------------------------------- 보고서

program
  .command("report-new <projectId>")
  .requiredOption("--title <t>")
  .requiredOption("--body <file>")
  .option("--links <codes>", "쉼표로 구분된 trackingCode 목록")
  .action((projectId, opts) =>
    run(async () => {
      const fs = await import("node:fs");
      const body = fs.readFileSync(opts.body, "utf-8");
      const links = opts.links ? String(opts.links).split(",").map((s: string) => s.trim()) : undefined;
      printJson(
        await apiCall(`/api/projects/${projectId}/reports`, {
          method: "POST",
          body: JSON.stringify({ title: opts.title, body, links }),
        }),
      );
    }),
  );

// ---------------------------------------------------------------- 질의/답변 (pending/reply)

program
  .command("question <trackingCode> <text...>")
  .action((trackingCode, textParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${trackingCode}/questions`, {
          method: "POST",
          body: JSON.stringify({ text: textParts.join(" ") }),
        }),
      ),
    ),
  );

program
  .command("pending <projectId>")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/pending`))));

program
  .command("reply <questionTrackingCode> <answer...>")
  .action((questionTrackingCode, answerParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/questions/${questionTrackingCode}/answer`, {
          method: "POST",
          body: JSON.stringify({ body: answerParts.join(" ") }),
        }),
      ),
    ),
  );

// ---------------------------------------------------------------- 코멘트

const commentCmd = program.command("comment").description("문서 코멘트");

commentCmd
  .command("list <projectId> <trackingCode>")
  .action((projectId, trackingCode) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/documents/${trackingCode}/comments`))),
  );

commentCmd
  .command("add <projectId> <trackingCode> <body...>")
  .action((projectId, trackingCode, bodyParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/documents/${trackingCode}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: bodyParts.join(" ") }),
        }),
      ),
    ),
  );

commentCmd
  .command("resolve <projectId> <commentId>")
  .action((projectId, commentId) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/comments/${commentId}/resolve`, { method: "POST" }))),
  );

// ---------------------------------------------------------------- 템플릿 (CLAUDE.md, SKILL.md 등)

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
  .option("--institution <id>", "이 기관 스코프에 override 설정")
  .action((filename, file, opts) =>
    run(async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(file, "utf-8");
      const qs = new URLSearchParams({ filename });
      printJson(
        await apiCall(`/api/templates?${qs}`, {
          method: "PUT",
          body: JSON.stringify({
            content,
            institutionId: opts.institution,
            projectGroupId: opts.group,
            projectId: opts.project,
          }),
        }),
      );
    }),
  );

templateCmd
  .command("deploy <projectId>")
  .action((projectId) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/templates/deploy`, { method: "POST" }))),
  );

// ---------------------------------------------------------------- diff / message (Phase 0 - 자리만, Phase 2/4에서 구현)

const gitCmd = program.command("git").description("git 이력(Phase 2에서 구현)");
gitCmd.command("log <projectId>").action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/log`))));
gitCmd.command("diff <projectId> <sha>").action((projectId, sha) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/diff/${sha}`))));
gitCmd.command("blame <projectId>").action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/blame`))));
gitCmd.command("show <projectId> <sha>").action((projectId, sha) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/show/${sha}`))));

const messageCmd = program.command("message").description("인스턴스 메시징(Phase 4에서 구현)");
messageCmd.command("list <projectId>").action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`))));
messageCmd.command("send <projectId> <body...>").action((projectId, bodyParts) =>
  run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify({ body: bodyParts.join(" ") }) }))),
);
messageCmd
  .command("wait <projectId>")
  .option("--timeout <sec>", "타임아웃(초)", "60")
  .action((projectId, opts) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/wait?timeout=${opts.timeout}`))));

program.parse();
