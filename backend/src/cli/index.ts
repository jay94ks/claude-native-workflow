#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { apiCall, apiCallText, saveCredentials, loadCredentials, clearCredentials, credentialsPath } from "./apiclient.js";
import { scanDirectory, applyManifest } from "./migrate.js";

const program = new Command();
program.name("docs").description("claude-native-workflow v2 문서 워크플로우 CLI").version("0.1.0");

// AI 안내(prologue) - 응답에 notices 배열이 있으면 JSON을 찍기 전에
// 각 줄을 먼저 출력한다(필드 자체는 JSON에도 그대로 남김 - 사람이 읽는
// 출력과 파싱하는 코드 양쪽 다 신호를 받게).
function printJson(value: unknown): void {
  if (value && typeof value === "object" && Array.isArray((value as { notices?: unknown }).notices)) {
    for (const notice of (value as { notices: string[] }).notices) {
      console.log(`⚠ ${notice}`);
    }
  }
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
    if (creds?.refresh_token) {
      await apiCall("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: creds.refresh_token }),
      }).catch(() => {});
    }
    clearCredentials();
    console.log("로그아웃 완료.");
  }),
);

authCmd
  .command("use-key")
  .description("API 키로 인증(로그인 왕복 없이 바로 저장 - `docs key create`로 발급받은 값)")
  .requiredOption("--api <url>", "서버 주소")
  .requiredOption("--key <k>", "cnwk_로 시작하는 API 키")
  .action((opts) =>
    run(async () => {
      saveCredentials({ api_base: opts.api, api_key: opts.key });
      console.log(`API 키를 ${credentialsPath}에 저장했습니다(권한 600).`);
    }),
  );

authCmd.command("whoami").action(() =>
  run(async () => {
    const creds = loadCredentials();
    if (!creds) { console.log("로그인되어 있지 않습니다"); return; }
    printJson(await apiCall("/api/auth/me"));
  }),
);

// ---------------------------------------------------------------- 프로필

const profileCmd = program.command("profile").description("내 프로필 관리");

profileCmd
  .command("set")
  .option("--email <e>")
  .option("--phone <p>")
  .option("--email-visible <bool>", "true|false")
  .option("--phone-visible <bool>", "true|false")
  .action((opts) =>
    run(async () =>
      printJson(
        await apiCall("/api/auth/me", {
          method: "PUT",
          body: JSON.stringify({
            email: opts.email,
            phone: opts.phone,
            emailVisible: opts.emailVisible !== undefined ? opts.emailVisible === "true" : undefined,
            phoneVisible: opts.phoneVisible !== undefined ? opts.phoneVisible === "true" : undefined,
          }),
        }),
      ),
    ),
  );

// ---------------------------------------------------------------- 사용자 프로필 조회/활동 이력

const userCmd = program.command("user").description("다른 설계자의 공개 프로필/활동 이력 조회");

userCmd
  .command("get <userId>")
  .action((userId) => run(async () => printJson(await apiCall(`/api/users/${userId}`))));

userCmd
  .command("activity <userId>")
  .option("--limit <n>", "최근 N건(기본 30)")
  .action((userId, opts) =>
    run(async () => {
      const qs = opts.limit ? `?limit=${encodeURIComponent(opts.limit)}` : "";
      printJson(await apiCall(`/api/users/${userId}/activity${qs}`));
    }),
  );

// ---------------------------------------------------------------- API 키(신원 위임 인증, 3종)
// MCP 도구는 의도적으로 없음(auth register/login과 같은 급의 신원
// 관리 동작 - CLI 전용, 사람이 터미널에서 직접 하는 동작으로 제한).

const keyCmd = program.command("key").description("API 키 관리(팀 관리 키/프로젝트 개인 키/개인 키)");

keyCmd
  .command("create")
  .requiredOption("--scope <s>", "personal|project|team")
  .option("--project <id>", "scope=project일 때 필요")
  .option("--team <id>", "scope=team일 때 필요")
  .option("--label <text>", "식별용 라벨(선택)")
  .action((opts) =>
    run(async () => {
      const result = await apiCall<{ key: unknown; secret: string }>(
        opts.scope === "project"
          ? `/api/projects/${opts.project}/api-keys`
          : opts.scope === "team"
            ? `/api/teams/${opts.team}/api-keys`
            : "/api/api-keys/personal",
        { method: "POST", body: JSON.stringify({ label: opts.label }) },
      );
      printJson(result.key);
      console.log(`\n⚠ 이 값은 지금 한 번만 표시됩니다 - 안전한 곳에 저장하세요:\n${result.secret}\n`);
    }),
  );

keyCmd
  .command("list")
  .option("--project <id>")
  .option("--team <id>")
  .option("--mine", "개인 키(전체 프로젝트 접근) 목록")
  .action((opts) =>
    run(async () => {
      if (opts.project) { printJson(await apiCall(`/api/projects/${opts.project}/api-keys`)); return; }
      if (opts.team) { printJson(await apiCall(`/api/teams/${opts.team}/api-keys`)); return; }
      if (opts.mine) { printJson(await apiCall("/api/api-keys/personal")); return; }
      throw new Error("--project <id> | --team <id> | --mine 중 하나가 필요합니다");
    }),
  );

keyCmd
  .command("revoke <keyId>")
  .action((keyId) => run(async () => printJson(await apiCall(`/api/api-keys/${keyId}`, { method: "DELETE" }))));

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

// ---------------------------------------------------------------- 팀/그룹/프로젝트

program
  .command("team-create <name>")
  .action((name) => run(async () => printJson(await apiCall("/api/teams", { method: "POST", body: JSON.stringify({ name }) }))));

program.command("teams").action(() => run(async () => printJson(await apiCall("/api/teams"))));

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
  .action((teamId) => run(async () => printJson(await apiCall(`/api/teams/${teamId}/admins`))));

program
  .command("group-create <name>")
  .option("--team <id>")
  .action((name, opts) =>
    run(async () =>
      printJson(
        await apiCall("/api/project-groups", {
          method: "POST",
          body: JSON.stringify({ name, teamId: opts.team }),
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
  .option("--guideline <text>", "이 타입은 무엇을 하기 위한 것인지(선택)")
  .action((projectId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types`, {
          method: "POST",
          body: JSON.stringify({ code, label, guideline: opts.guideline }),
        }),
      ),
    ),
  );

program
  .command("doctypes <projectId>")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/doc-types`))));

program
  .command("doctype-guideline-set <projectId> <docTypeId> <guideline...>")
  .action((projectId, docTypeId, guidelineParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}/guideline`, {
          method: "PUT",
          body: JSON.stringify({ guideline: guidelineParts.join(" ") }),
        }),
      ),
    ),
  );

program
  .command("team-doctype-create <teamId> <code> <label>")
  .option("--guideline <text>", "이 타입은 무엇을 하기 위한 것인지(선택)")
  .action((teamId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/teams/${teamId}/doc-types`, {
          method: "POST",
          body: JSON.stringify({ code, label, guideline: opts.guideline }),
        }),
      ),
    ),
  );

program
  .command("team-doctypes <teamId>")
  .action((teamId) => run(async () => printJson(await apiCall(`/api/teams/${teamId}/doc-types`))));

program
  .command("team-doctype-guideline-set <teamId> <docTypeId> <guideline...>")
  .action((teamId, docTypeId, guidelineParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/teams/${teamId}/doc-types/${docTypeId}/guideline`, {
          method: "PUT",
          body: JSON.stringify({ guideline: guidelineParts.join(" ") }),
        }),
      ),
    ),
  );

program
  .command("group-doctype-create <groupId> <code> <label>")
  .option("--guideline <text>", "이 타입은 무엇을 하기 위한 것인지(선택)")
  .action((groupId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/project-groups/${groupId}/doc-types`, {
          method: "POST",
          body: JSON.stringify({ code, label, guideline: opts.guideline }),
        }),
      ),
    ),
  );

program
  .command("group-doctypes <groupId>")
  .action((groupId) => run(async () => printJson(await apiCall(`/api/project-groups/${groupId}/doc-types`))));

program
  .command("group-doctype-guideline-set <groupId> <docTypeId> <guideline...>")
  .action((groupId, docTypeId, guidelineParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/project-groups/${groupId}/doc-types/${docTypeId}/guideline`, {
          method: "PUT",
          body: JSON.stringify({ guideline: guidelineParts.join(" ") }),
        }),
      ),
    ),
  );

program
  .command("doctype-status-add <projectId> <docTypeId> <code>")
  .description("code는 draft/review/pending/approved/deprecated/archived 중 하나(라벨/지침/종료 여부는 표준값 고정)")
  .action((projectId, docTypeId, code) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}/statuses`, {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      ),
    ),
  );

program
  .command("doctype-apply-standard-flow <projectId> <docTypeId>")
  .description("표준 상태 6개(draft/review/pending/approved/deprecated/archived) + 전이를 한 번에 세팅")
  .action((projectId, docTypeId) =>
    run(async () =>
      printJson(await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}/standard-flow`, { method: "POST" })),
    ),
  );

program
  .command("doctype-transition-add <projectId> <docTypeId> <fromCode> <toCode>")
  .option("--label <l>", "전이 라벨(선택)")
  .action((projectId, docTypeId, fromCode, toCode, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}/transitions`, {
          method: "POST",
          body: JSON.stringify({ fromStatusCode: fromCode, toStatusCode: toCode, label: opts.label }),
        }),
      ),
    ),
  );

program
  .command("doctype-transitions <projectId> <docTypeId>")
  .action((_projectId, docTypeId) => run(async () => printJson(await apiCall(`/api/doc-types/${docTypeId}/transitions`))));

program
  .command("team-doctype-status-add <teamId> <docTypeId> <code>")
  .action((teamId, docTypeId, code) =>
    run(async () =>
      printJson(
        await apiCall(`/api/teams/${teamId}/doc-types/${docTypeId}/statuses`, {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      ),
    ),
  );

program
  .command("team-doctype-apply-standard-flow <teamId> <docTypeId>")
  .action((teamId, docTypeId) =>
    run(async () =>
      printJson(await apiCall(`/api/teams/${teamId}/doc-types/${docTypeId}/standard-flow`, { method: "POST" })),
    ),
  );

program
  .command("team-doctype-transition-add <teamId> <docTypeId> <fromCode> <toCode>")
  .option("--label <l>", "전이 라벨(선택)")
  .action((teamId, docTypeId, fromCode, toCode, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/teams/${teamId}/doc-types/${docTypeId}/transitions`, {
          method: "POST",
          body: JSON.stringify({ fromStatusCode: fromCode, toStatusCode: toCode, label: opts.label }),
        }),
      ),
    ),
  );

program
  .command("group-doctype-status-add <groupId> <docTypeId> <code>")
  .action((groupId, docTypeId, code) =>
    run(async () =>
      printJson(
        await apiCall(`/api/project-groups/${groupId}/doc-types/${docTypeId}/statuses`, {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      ),
    ),
  );

program
  .command("group-doctype-apply-standard-flow <groupId> <docTypeId>")
  .action((groupId, docTypeId) =>
    run(async () =>
      printJson(await apiCall(`/api/project-groups/${groupId}/doc-types/${docTypeId}/standard-flow`, { method: "POST" })),
    ),
  );

program
  .command("group-doctype-transition-add <groupId> <docTypeId> <fromCode> <toCode>")
  .option("--label <l>", "전이 라벨(선택)")
  .action((groupId, docTypeId, fromCode, toCode, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/project-groups/${groupId}/doc-types/${docTypeId}/transitions`, {
          method: "POST",
          body: JSON.stringify({ fromStatusCode: fromCode, toStatusCode: toCode, label: opts.label }),
        }),
      ),
    ),
  );

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

program
  .command("revisions <trackingCode>")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/revisions`))));

program
  .command("delete <trackingCode>")
  .description("문서를 삭제한다(리비전/링크/코멘트/질문+답변까지 함께 정리)")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}`, { method: "DELETE" }))));

program
  .command("next-statuses <trackingCode>")
  .description("이 문서에서 지금 선택 가능한 다음 상태 목록(코드/라벨/지침)")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/next-statuses`))));

// ---------------------------------------------------------------- 연관된 소스코드

program
  .command("link-source <trackingCode> <path>")
  .description("이 문서와 연관된 소스코드 파일 경로를 연결한다(git 저장소 루트 기준 상대 경로)")
  .action((trackingCode, path) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${trackingCode}/source-links`, {
          method: "POST",
          body: JSON.stringify({ filePath: path }),
        }),
      ),
    ),
  );

program
  .command("unlink-source <trackingCode> <linkId>")
  .description("연결된 소스코드 링크를 제거한다")
  .action((trackingCode, linkId) =>
    run(async () =>
      printJson(
        await apiCall(`/api/document-source-links/${linkId}?trackingCode=${encodeURIComponent(trackingCode)}`, {
          method: "DELETE",
        }),
      ),
    ),
  );

program
  .command("source-links <trackingCode>")
  .description("이 문서와 연관된 소스코드 파일 경로 목록")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/source-links`))));

// ---------------------------------------------------------------- 세부 접근 권한

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
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/access`))));

// ---------------------------------------------------------------- 칸반 보드
// 코멘트/폴더와 달리 이 기능은 AI에게 완전히 노출된다 - 컬럼 순서/숨김
// 변경과 카드 코멘트만 예외로 CLI/MCP에 없다(개인 UI 설정이거나
// 설계자간 채널).

program
  .command("kanban-columns <projectId>")
  .description("이 프로젝트의 칸반 분류 목록(순서/숨김은 이 계정 기준)")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/kanban/columns`))));

program
  .command("kanban-card-new <projectId> <columnId> <title>")
  .description("칸반 카드를 만들어 분류에 추가한다(AI가 만든 카드로 기록됨)")
  .option("--body <text>", "카드 설명")
  .option("--refs <codes>", "쉼표로 구분된 근거 문서 trackingCode 목록")
  .action((projectId, columnId, title, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/kanban/cards`, {
          method: "POST",
          body: JSON.stringify({
            columnId,
            title,
            body: opts.body,
            refs: opts.refs ? opts.refs.split(",").filter(Boolean) : undefined,
            origin: "ai",
          }),
        }),
      ),
    ),
  );

program
  .command("kanban-cards <projectId>")
  .description("칸반 카드 목록(숨긴 카드 제외)")
  .option("--column <columnId>", "특정 분류로 제한")
  .action((projectId, opts) =>
    run(async () => {
      const qs = opts.column ? `?columnId=${opts.column}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/kanban/cards${qs}`));
    }),
  );

program
  .command("kanban-card-get <trackingCode>")
  .description("칸반 카드 상세(근거 문서 포함)")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/kanban/cards/${trackingCode}`))));

program
  .command("kanban-card-move <trackingCode> <toColumnId>")
  .description("칸반 카드를 다른 분류로 옮긴다")
  .option("--index <n>", "그 분류 안에서의 위치(생략 시 맨 끝)")
  .action((trackingCode, toColumnId, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/kanban/cards/${trackingCode}/move`, {
          method: "PUT",
          body: JSON.stringify({ toColumnId, toIndex: opts.index !== undefined ? Number(opts.index) : undefined }),
        }),
      ),
    ),
  );

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
// targetType/targetKey로 다형화됨(document/source/kanbanCard) - document/
// kanbanCard 대상은 그 자신의 트래킹 코드만으로 서버가 대상 종류를
// 자동 판별하므로(resolveTargetByTrackingCode) 기존 2-인자 시그니처를
// 그대로 쓴다. source 대상은 트래킹 코드가 없어 별도 명령이 필요하다.

program
  .command("question <trackingCode> <text...>")
  .option("--kind <approval|answer>", "승인 요청 또는 답변 요청(기본: answer)")
  .option("--refs <codes>", "판단에 참고한 문서 trackingCode 목록(쉼표로 구분)")
  .action((trackingCode, textParts, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/questions`, {
          method: "POST",
          body: JSON.stringify({
            trackingCode,
            kind: opts.kind ?? "answer",
            text: textParts.join(" "),
            refs: opts.refs ? String(opts.refs).split(",").map((s: string) => s.trim()) : undefined,
          }),
        }),
      ),
    ),
  );

program
  .command("question-source <projectId> <path> <text...>")
  .description("소스 코드 파일에 AI 질문을 남긴다(문서/칸반 카드가 아닌 대상)")
  .option("--kind <approval|answer>", "승인 요청 또는 답변 요청(기본: answer)")
  .option("--refs <codes>", "판단에 참고한 문서 trackingCode 목록(쉼표로 구분)")
  .action((projectId, path, textParts, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/questions/source`, {
          method: "POST",
          body: JSON.stringify({
            path,
            kind: opts.kind ?? "answer",
            text: textParts.join(" "),
            refs: opts.refs ? String(opts.refs).split(",").map((s: string) => s.trim()) : undefined,
          }),
        }),
      ),
    ),
  );

program
  .command("questions <trackingCode>")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/questions?trackingCode=${trackingCode}`))));

program
  .command("questions-source <projectId> <path>")
  .action((projectId, path) =>
    run(async () =>
      printJson(await apiCall(`/api/projects/${projectId}/questions/source?path=${encodeURIComponent(path)}`)),
    ),
  );

program
  .command("question-ack <trackingCode>")
  .description("설계자가 답변한(pending) 질의를 확인 완료(resolved)로 표시")
  .action((trackingCode) =>
    run(async () => printJson(await apiCall(`/api/questions/${trackingCode}/ack`, { method: "POST" }))),
  );

program
  .command("pending <projectId>")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/pending`))));

program
  .command("reply <questionTrackingCode> [answer...]")
  .description("답변 요청(kind=answer)은 answer 텍스트로, 승인 요청(kind=approval)은 --decision으로 답한다")
  .option("--decision <approved|rejected>", "승인 요청에 대한 결정")
  .action((questionTrackingCode, answerParts, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/questions/${questionTrackingCode}/answer`, {
          method: "POST",
          body: JSON.stringify({
            body: answerParts && answerParts.length > 0 ? answerParts.join(" ") : undefined,
            decision: opts.decision,
          }),
        }),
      ),
    ),
  );

// 코멘트는 설계자들끼리만 쓰는 채널이다(웹 UI 전용) - AI의 참고 지표가
// 될 수 없어 CLI/MCP엔 의도적으로 명령/도구를 두지 않는다("CLI/MCP
// 명령어 완전성" 원칙의 의도적 예외 - REST API/웹 UI는 그대로, 소스
// 코드/칸반 카드 코멘트도 동일하게 없음).

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
  .option("--team <id>", "이 팀 스코프에 override 설정")
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
  .action((projectId) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/templates/deploy`, { method: "POST" }))),
  );

// ---------------------------------------------------------------- git 저장소 연결 + 이력 조회 (Phase 2)

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  .command("log <projectId>")
  .option("--ref <ref>", "브랜치/커밋 ref(생략하면 기본 브랜치)")
  .action((projectId, opts) => {
    const qs = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : "";
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/log${qs}`)));
  });

gitCmd
  .command("diff <projectId> <sha>")
  .action((projectId, sha) => run(async () => console.log(await apiCallText(`/api/projects/${projectId}/git/diff/${sha}`))));

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

gitCmd
  .command("tree <projectId>")
  .option("--path <path>", "디렉터리 경로(생략하면 루트)", "")
  .option("--ref <ref>")
  .action((projectId, opts) => {
    const qs = new URLSearchParams({ path: opts.path, ...(opts.ref ? { ref: opts.ref } : {}) });
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/tree?${qs}`)));
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
  .command("put <projectId> <path> <localFile>")
  .option("--message <m>", "커밋 메시지")
  .action((projectId, path, localFile, opts) =>
    run(async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(localFile, "utf-8");
      const qs = new URLSearchParams({ path });
      printJson(
        await apiCall(`/api/projects/${projectId}/git/file?${qs}`, {
          method: "PUT",
          body: JSON.stringify({ content, message: opts.message }),
        }),
      );
    }),
  );

// ---------------------------------------------------------------- git push 훅 프롬프트 자동화 (Phase 3 - 대기열 방식)

const hookCmd = program.command("hook").description("git push 훅 프롬프트 자동화(대기열)");

hookCmd
  .command("create <projectId>")
  .requiredOption("--prompt <file>", "프롬프트 내용이 담긴 로컬 파일")
  .option("--branch <branch>", "이 브랜치로 push될 때만 매칭(생략하면 모든 브랜치)")
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
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts`))));

hookCmd
  .command("delete <projectId> <id>")
  .action((projectId, id) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts/${id}`, { method: "DELETE" }))),
  );

hookCmd
  .command("queue <projectId>")
  .option("--status <s>", "pending|acknowledged|done(생략하면 전체)")
  .action((projectId, opts) => {
    const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : "";
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-queue${qs}`)));
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

const messageCmd = program.command("message").description("인스턴스 메시징 - 대기(AI 미확인)/기록(AI 확인함) 상태 구분");
messageCmd
  .command("list <projectId>")
  .option("--status <s>", "pending|delivered|all(기본 all)")
  .description("CLI로 조회하면 대기 상태였던 메시지가 자동으로 기록 처리된다(AI가 읽어감의 정의)")
  .action((projectId, opts) => {
    const qs = new URLSearchParams({ markDelivered: "true", ...(opts.status ? { status: opts.status } : {}) });
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages?${qs}`)));
  });
messageCmd.command("send <projectId> <body...>").action((projectId, bodyParts) =>
  run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify({ body: bodyParts.join(" ") }) }))),
);
messageCmd
  .command("wait <projectId>")
  .option("--timeout <sec>", "타임아웃(초)", "60")
  .action((projectId, opts) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/wait?timeout=${opts.timeout}`))));
messageCmd
  .command("recent <projectId>")
  .option("--limit <n>", "기본 20")
  .description("장애 복구용 - 상태를 바꾸지 않는 순수 조회(반복 호출해도 안전), 대기/기록 구분 없이 최신순")
  .action((projectId, opts) => {
    const qs = opts.limit ? `?limit=${encodeURIComponent(opts.limit)}` : "";
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/recent${qs}`)));
  });

// ---------------------------------------------------------------- 가이디드 마이그레이션 (Phase 6)

const migrateCmd = program.command("migrate").description("파일 기반(concept 스타일) 프로젝트를 DB로 옮기기");

migrateCmd
  .command("scan <sourceDir>")
  .description("sourceDir를 스캔해 후보 목록을 JSON으로 출력(리다이렉트해 매니페스트로 씀)")
  .action((sourceDir) => run(async () => printJson(scanDirectory(sourceDir))));

migrateCmd
  .command("apply <projectId> <manifestFile>")
  .description("검토·수정한 매니페스트를 실제로 반영")
  .action((projectId, manifestFile) => run(async () => printJson(await applyManifest(projectId, manifestFile))));

program.parse();
