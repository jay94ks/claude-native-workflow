#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { apiCall, apiCallText, saveCredentials, loadCredentials, clearCredentials, credentialsPath, waitForMessageDirect, detectCurrentGitBranch } from "./apiclient.js";
import { scanDirectory, applyManifest } from "./migrate.js";
import { syncDocumentCache, cleanDocumentCache } from "./cache.js";

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

// "--choices" 플래그 파싱 - 선택지끼리는 ";;", 한 선택지 안 라벨/
// 부가정보는 ":::"로 구분한다(--refs의 쉼표 구분 관례를 참고 -
// 라벨/부가정보 텍스트 안에 쉼표가 흔히 들어갈 수 있어 더 드문
// 구분자를 쓴다).
function parseChoices(raw?: string): { label: string; detail?: string }[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(";;")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [label, ...rest] = s.split(":::");
      const detail = rest.join(":::").trim();
      return { label: label.trim(), detail: detail || undefined };
    });
  return items.length > 0 ? items : undefined;
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

authCmd
  .command("change-password")
  .description("이미 로그인된 상태에서 본인 비밀번호를 직접 바꾼다(잊어버렸을 때의 admin 대행 재설정과는 다른 경로 - user reset-password 참고)")
  .requiredOption("--current <p>", "현재 비밀번호")
  .requiredOption("--new <p>", "새 비밀번호(최소 8자)")
  .action((opts) =>
    run(async () => {
      await apiCall("/api/auth/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: opts.current, newPassword: opts.new }),
      });
      console.log("비밀번호를 변경했습니다.");
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
  .option("--nickname <n>", "7일 쿨다운 - 최근 변경 후엔 값을 안 바꿔야만 재저장 가능, 비우면 공통 라벨 '설계자'로 표시")
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
            nickname: opts.nickname,
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

userCmd
  .command("list")
  .description("전체 사용자 목록 조회(관리자 전용)")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/admin/users${paged ? "/page" : ""}${qs}`));
    }),
  );

userCmd
  .command("reset-password <userId>")
  .description("다른 설계자의 비밀번호를 임시 비밀번호로 재설정한다(관리자 전용)")
  .action((userId) =>
    run(async () => {
      const result = await apiCall<{ username: string; temporaryPassword: string }>(
        `/api/admin/users/${userId}/reset-password`,
        { method: "POST" },
      );
      console.log(`이 값은 지금 한 번만 표시됩니다 - 안전한 곳에 저장하세요:`);
      printJson(result);
    }),
  );

userCmd
  .command("access-overview <userId>")
  .description("이 설계자가 전체 설치에서 어떤 접근 제한을 받고 있는지 프로젝트를 가로질러 한 번에 조회(관리자 전용)")
  .action((userId) => run(async () => printJson(await apiCall(`/api/admin/users/${userId}/access-overview`))));

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
  .option("--expires-in <days>", "만료까지 일수(선택, 양의 정수 - 지정하지 않으면 배제 전까지 무기한)")
  .action((opts) =>
    run(async () => {
      let expiresAt: string | undefined;
      if (opts.expiresIn !== undefined) {
        const days = Number(opts.expiresIn);
        if (!Number.isInteger(days) || days <= 0) throw new Error("--expires-in은 양의 정수(일수)여야 합니다");
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }
      const result = await apiCall<{ key: unknown; secret: string }>(
        opts.scope === "project"
          ? `/api/projects/${opts.project}/api-keys`
          : opts.scope === "team"
            ? `/api/teams/${opts.team}/api-keys`
            : "/api/api-keys/personal",
        { method: "POST", body: JSON.stringify({ label: opts.label, expiresAt }) },
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
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      if (opts.project) { printJson(await apiCall(`/api/projects/${opts.project}/api-keys${paged ? "/page" : ""}${qs}`)); return; }
      if (opts.team) { printJson(await apiCall(`/api/teams/${opts.team}/api-keys${paged ? "/page" : ""}${qs}`)); return; }
      if (opts.mine) { printJson(await apiCall(`/api/api-keys/personal${paged ? "/page" : ""}${qs}`)); return; }
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

credCmd
  .command("list")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/credentials${paged ? "/page" : ""}${qs}`));
    }),
  );

credCmd
  .command("remove <id>")
  .action((id) => run(async () => printJson(await apiCall(`/api/credentials/${id}`, { method: "DELETE" }))));

// ---------------------------------------------------------------- 코드 관계도(Code Relation Graph)
// Claude가 코드 탐색 중 스스로 발견한 "무엇이 어디서 왜 참조되는지"를
// 기록해두는 개인 인덱스 - 프로젝트 내 설계자(로그인 계정)별로
// 완전히 독립적이다(폴더와 동일 원칙). 상위/하위는 단일 부모 트리가
// 아니라 다대다 그래프(순환 허용) - 한 관계가 여러 부모/여러 자식을
// 동시에 가질 수 있다. --tags/--parents/--children류는 이 저장소의
// --refs 관례와 동일하게 쉼표로 구분한 문자열 하나로 받는다.

const relCmd = program.command("relation").description("코드 관계도(관계 그래프) 관리");

function splitCsv(raw?: string): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseDataOption(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("--data는 올바른 JSON이어야 합니다");
  }
}

relCmd
  .command("add <projectId>")
  .requiredOption("--target <t>")
  .requiredOption("--referrer <r>")
  .requiredOption("--purpose <p>")
  .requiredOption("--file <path>")
  .option("--line <n>")
  .option("--column <n>")
  .option("--data <json>")
  .option("--refs <codes>", "쉼표로 구분된 연관 문서 trackingCode 목록(여러 개 가능)")
  .option("--tags <t1,t2>", "쉼표로 구분")
  .option("--parents <id1,id2>", "쉼표로 구분 - 상위 관계 id들")
  .option("--children <id1,id2>", "쉼표로 구분 - 하위 관계 id들")
  .option("--branch <name>", "생략하면 현재 디렉터리의 git 브랜치를 자동 감지")
  .action((projectId, opts) =>
    run(async () => {
      printJson(
        await apiCall(`/api/projects/${projectId}/relations`, {
          method: "POST",
          body: JSON.stringify({
            target: opts.target,
            referrer: opts.referrer,
            purpose: opts.purpose,
            filePath: opts.file,
            line: opts.line !== undefined ? Number(opts.line) : undefined,
            column: opts.column !== undefined ? Number(opts.column) : undefined,
            data: parseDataOption(opts.data),
            trackingCodes: splitCsv(opts.refs),
            tags: splitCsv(opts.tags),
            parentIds: splitCsv(opts.parents),
            childIds: splitCsv(opts.children),
            branchName: opts.branch ?? detectCurrentGitBranch() ?? undefined,
          }),
        }),
      );
    }),
  );

relCmd
  .command("update <projectId> <id>")
  .option("--target <t>")
  .option("--referrer <r>")
  .option("--purpose <p>")
  .option("--file <path>")
  .option("--line <n>")
  .option("--column <n>")
  .option("--data <json>")
  .option("--refs <codes>", "쉼표로 구분된 연관 문서 trackingCode 목록 - 전체를 이 목록으로 교체")
  .option("--tags <t1,t2>", "쉼표로 구분 - 전체를 이 목록으로 교체")
  .option("--add-parents <id1,id2>", "쉼표로 구분")
  .option("--remove-parents <id1,id2>", "쉼표로 구분")
  .option("--add-children <id1,id2>", "쉼표로 구분")
  .option("--remove-children <id1,id2>", "쉼표로 구분")
  .option("--branch <name>", "명시해야만 갱신됨(생략하면 기존 값 유지 - 자동 감지 안 함)")
  .action((projectId, id, opts) =>
    run(async () => {
      printJson(
        await apiCall(`/api/projects/${projectId}/relations/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            target: opts.target,
            referrer: opts.referrer,
            purpose: opts.purpose,
            filePath: opts.file,
            line: opts.line !== undefined ? Number(opts.line) : undefined,
            column: opts.column !== undefined ? Number(opts.column) : undefined,
            data: parseDataOption(opts.data),
            trackingCodes: splitCsv(opts.refs),
            tags: splitCsv(opts.tags),
            addParentIds: splitCsv(opts.addParents),
            removeParentIds: splitCsv(opts.removeParents),
            addChildIds: splitCsv(opts.addChildren),
            removeChildIds: splitCsv(opts.removeChildren),
            branchName: opts.branch,
          }),
        }),
      );
    }),
  );

relCmd
  .command("remove <projectId> <id>")
  .action((projectId, id) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}`, { method: "DELETE" }))),
  );

relCmd
  .command("get <projectId> <id>")
  .action((projectId, id) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}`))));

relCmd
  .command("list <projectId>")
  .option("--q <query>")
  .option("--file <path>", "filePath 정확 일치")
  .option("--ref <trackingCode>", "이 문서를 연관 문서로 갖는 관계만(정확 일치)")
  .option("--tag <tag>")
  .option("--root-only", "상위 관계가 없는 최상위만")
  .option("--branch <name>", "생략하면 현재 디렉터리의 git 브랜치를 자동 감지해서 필터")
  .option("--all-branches", "브랜치 필터 없이 전체(과거 데이터 포함) 조회")
  .option("--page <n>")
  .option("--count <n>")
  .action((projectId, opts) =>
    run(async () => {
      const qs = new URLSearchParams();
      if (opts.q) qs.set("q", opts.q);
      if (opts.file) qs.set("filePath", opts.file);
      if (opts.ref) qs.set("trackingCode", opts.ref);
      if (opts.tag) qs.set("tag", opts.tag);
      if (opts.rootOnly) qs.set("hasNoParent", "true");
      if (opts.allBranches) qs.set("allBranches", "true");
      else qs.set("branchName", opts.branch ?? detectCurrentGitBranch() ?? "");
      if (opts.page !== undefined) qs.set("page", opts.page);
      if (opts.count !== undefined) qs.set("pageSize", opts.count);
      printJson(await apiCall(`/api/projects/${projectId}/relations?${qs}`));
    }),
  );

relCmd
  .command("parents <projectId> <id>")
  .action((projectId, id) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/parents`))),
  );

relCmd
  .command("children <projectId> <id>")
  .action((projectId, id) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/children`))),
  );

relCmd
  .command("ancestors <projectId> <id>")
  .option("--depth <n>", "기본 3")
  .option("--tag <tag>")
  .option("--q <query>")
  .action((projectId, id, opts) =>
    run(async () => {
      const qs = new URLSearchParams();
      if (opts.depth !== undefined) qs.set("depth", opts.depth);
      if (opts.tag) qs.set("tag", opts.tag);
      if (opts.q) qs.set("q", opts.q);
      printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/ancestors?${qs}`));
    }),
  );

relCmd
  .command("descendants <projectId> <id>")
  .option("--depth <n>", "기본 3")
  .option("--tag <tag>")
  .option("--q <query>")
  .action((projectId, id, opts) =>
    run(async () => {
      const qs = new URLSearchParams();
      if (opts.depth !== undefined) qs.set("depth", opts.depth);
      if (opts.tag) qs.set("tag", opts.tag);
      if (opts.q) qs.set("q", opts.q);
      printJson(await apiCall(`/api/projects/${projectId}/relations/${id}/descendants?${qs}`));
    }),
  );

// 항목이 target/referrer/purpose/file/line/column/data/tags/parentIds/
// childIds를 가진 완전한 구조체라 단순 variadic 인자로는 못 받는다
// (기존 bulk 명령들은 전부 문자열 배열 하나뿐이었음) - 로컬 JSON 파일
// (항목 배열)을 읽어 그대로 보낸다. Claude가 Write 도구로 임시 파일을
// 만든 뒤 이 명령을 호출하는 흐름을 전제.
relCmd
  .command("add-bulk <projectId> <file>")
  .description("로컬 JSON 파일(항목 배열)로 여러 관계를 한 번에 추가한다")
  .action((projectId, file) =>
    run(async () => {
      const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
      printJson(await apiCall(`/api/projects/${projectId}/relations/bulk`, { method: "POST", body: JSON.stringify({ items }) }));
    }),
  );

relCmd
  .command("update-bulk <projectId> <file>")
  .description("로컬 JSON 파일(id 포함 항목 배열)로 여러 관계를 한 번에 갱신한다")
  .action((projectId, file) =>
    run(async () => {
      const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
      printJson(await apiCall(`/api/projects/${projectId}/relations/bulk`, { method: "PUT", body: JSON.stringify({ items }) }));
    }),
  );

relCmd
  .command("remove-bulk <projectId> <ids...>")
  .description("여러 관계를 id로 한 번에 삭제한다")
  .action((projectId, ids) =>
    run(async () =>
      printJson(await apiCall(`/api/projects/${projectId}/relations/bulk`, { method: "DELETE", body: JSON.stringify({ ids }) })),
    ),
  );

relCmd
  .command("reset <projectId>")
  .description("이 설계자의 관계도를 브랜치 기준으로 일괄 삭제한다(관계도 초기화)")
  .option("--branch <name>", "이 브랜치만 삭제(생략하면 '브랜치 없음' 버킷)")
  .option("--all-branches", "브랜치 구분 없이 전체 삭제")
  .action((projectId, opts) =>
    run(async () => {
      const qs = new URLSearchParams();
      if (opts.allBranches) qs.set("allBranches", "true");
      else qs.set("branchName", opts.branch ?? "__none__");
      printJson(await apiCall(`/api/projects/${projectId}/relations/reset?${qs}`, { method: "DELETE" }));
    }),
  );

// ---------------------------------------------------------------- Pull Request
// git 저장소 관리 기능(브랜치 목록/저장소 연동/발행 등)은 지금까지
// 웹 전용이었지만, PR은 이번에 CLI/MCP를 예외로 연다 - 자동 머지가
// 실패했을 때 AI(Claude)가 CLI로 직접 진단하고 수동 병합까지 완료할
// 수 있어야 하기 때문(설계자 요구사항 4번). PR 생성은 브랜치 선택
// UI와 강하게 결합돼 있어 여전히 웹에서만 한다.

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

// ---------------------------------------------------------------- 코드 리뷰(사후 검토) - 머지를 막는 게이트가 아니라 이미 반영된
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

// ---------------------------------------------------------------- 의견(Opinion) - 코멘트와 정반대 채널.
// 코멘트(웹 UI 전용, comments.ts)는 "설계자들끼리만 공유, AI 참고
// 지표가 될 수 없다"는 원칙으로 CLI/MCP가 없는데, 의견은 AI가 참고해야
// 하는 채널이라 그 반대다 - 문서/계획 화면의 "의견" 버튼으로 설계자가
// 남기고, AI가 여기서 직접 조회·확인 완료 처리한다. 생성 명령은
// 의도적으로 없음(설계자가 웹에서만 남긴다).
const opinionCmd = program.command("opinion").description("문서/계획에 설계자가 남긴 의견(AI 참고용) - 조회/확인 완료만, 생성은 웹 UI 전용");

opinionCmd
  .command("pending <projectId>")
  .description("아직 확인하지 않은(open) 의견 목록")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/opinions?${new URLSearchParams({ projectId, status: "open" })}`))));

opinionCmd
  .command("list <projectId>")
  .description("의견 목록 - --target으로 특정 문서/계획만, --status로 상태 제한(기본 open)")
  .option("--target <trackingCode>", "이 문서/계획의 의견만")
  .option("--status <status>", "open(기본) | resolved | all")
  .action((projectId, opts) =>
    run(async () => {
      const qs = new URLSearchParams({ projectId, status: opts.status ?? "open" });
      if (opts.target) qs.set("targetKey", opts.target);
      printJson(await apiCall(`/api/opinions?${qs}`));
    }),
  );

opinionCmd
  .command("resolve <opinionId>")
  .description("의견을 확인 완료(resolved)로 표시 - 되돌리기는 지원 안 함")
  .action((opinionId) => run(async () => printJson(await apiCall(`/api/opinions/${opinionId}/resolve`, { method: "POST" }))));

// ---------------------------------------------------------------- 팀/그룹/프로젝트

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
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/doc-types${paged ? "/page" : ""}${qs}`));
    }),
  );

program
  .command("doctype-update <projectId> <docTypeId>")
  .option("--code <c>", "타입 코드(영문 2글자) - 기본 시드 타입은 거부됨")
  .option("--label <l>")
  .action((projectId, docTypeId, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}`, {
          method: "PUT",
          body: JSON.stringify({ code: opts.code, label: opts.label }),
        }),
      ),
    ),
  );

program
  .command("doctype-delete <projectId> <docTypeId>")
  .description("문서 타입 삭제 - 이 타입으로 만든 문서가 하나라도 남아있으면 거부됨")
  .action((projectId, docTypeId) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}`, { method: "DELETE" }))),
  );

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

// ---------------------------------------------------------------- 문서

program
  .command("new <projectId> <docTypeCode>")
  .description("문서를 생성한다 - 응답에 본문은 없음(호출자가 이미 보낸 내용을 그대로 돌려주지 않음), updatedAt으로 생성 시각 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
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
  .description("문서 1건 조회(본문 포함) - 응답에 linksOut(이 문서가 링크한 문서)/backlinks(이 문서를 링크한 문서)로 연관 문서 추적코드도 함께 온다")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}`))));

program
  .command("list <projectId>")
  .description("문서 색인 조회(본문 제외 - trackingCode/title/docTypeId/statusCode 등 요약만) - 본문이 필요하면 get/read/grep으로 이어서 조회한다")
  .option("--type <docTypeId>")
  .option("--status <code>", "draft/review/pending/approved/deprecated/archived 중 하나로 필터 - 예: 검토 대기 목록은 --status review")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열(최대 1000건)")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = new URLSearchParams({
        ...(opts.type ? { docTypeId: opts.type } : {}),
        ...(opts.status ? { statusCode: opts.status } : {}),
        ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
      });
      const suffix = paged ? "/page" : "";
      printJson(await apiCall(`/api/projects/${projectId}/documents${suffix}${qs.toString() ? `?${qs}` : ""}`));
    }),
  );

program
  .command("search <projectId> <query>")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 관련도 상위 50건")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .option("--lines <n>", "각 히트의 본문을 앞 n줄까지만 자른다(생략하면 전체 본문) - 실제로 잘렸으면 결과의 bodyTruncated:true로 표시")
  .option("--codes-only", "본문/메타 없이 trackingCode 배열만 반환(--lines보다 더 가벼움 - 코드만 필요할 때)")
  .action((projectId, query, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = new URLSearchParams({
        q: query,
        ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
        ...(opts.lines !== undefined ? { lines: opts.lines } : {}),
        ...(opts.codesOnly ? { codesOnly: "true" } : {}),
      });
      printJson(await apiCall(`/api/projects/${projectId}/search?${qs}`));
    }),
  );

program
  .command("search-all <projectId> <query>")
  .description("문서(전문 검색)+계획(부분 일치)을 한 번에 훑는다 - 각 항목 kind(document|plan)/trackingCode/title/statusCode만 반환(본문 없음, 필요하면 get/plan get으로 이어서 조회)")
  .action((projectId, query) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/search-all?${new URLSearchParams({ q: query })}`))),
  );

program
  .command("refs-status <trackingCode>")
  .description("이 문서/계획/칸반 카드 본문에 언급된 모든 추적 코드의 현재 title/status를 한 번에 모아 본다(\"완료된 계획이 아직 미구현으로 언급됨\" 같은 불일치 탐지용) - 대상을 못 찾은 코드는 title/status가 null로 표시됨")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/refs-status/${trackingCode}`))));

program
  .command("save <trackingCode> <file>")
  .description("문서 본문을 덮어쓰고 버전 이력을 남긴다 - 응답에 본문은 없음(호출자가 이미 보낸 내용), updatedAt으로 저장 여부만 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
  .action((trackingCode, file) =>
    run(async () => {
      const fs = await import("node:fs");
      const body = fs.readFileSync(file, "utf-8");
      printJson(await apiCall(`/api/documents/${trackingCode}`, { method: "PUT", body: JSON.stringify({ body }) }));
    }),
  );

program
  .command("patch <trackingCode> <oldStr> <newStr>")
  .description("문서 본문의 일부만 바꾼다(str_replace 방식) - oldStr이 본문에 정확히 한 번만 있을 때만 적용, 없거나 여러 번 있으면 아무것도 안 바꾸고 실패. 본문 전체를 다시 안 보내도 됨")
  .option("--replace-all", "일치하는 곳 전부를 바꾼다(기본은 정확히 1번만 허용)")
  .action((trackingCode, oldStr, newStr, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${trackingCode}/patch`, {
          method: "PUT",
          body: JSON.stringify({ oldStr, newStr, replaceAll: !!opts.replaceAll }),
        }),
      ),
    ),
  );

program
  .command("patch-batch <file>")
  .description("로컬 JSON 파일(항목 배열: trackingCode/oldStr/newStr/replaceAll?)로 여러 문서를 한 번에 patch한다 - 항목별 성공/실패 반환(부분 성공 허용)")
  .action((file) =>
    run(async () => {
      const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
      printJson(await apiCall(`/api/documents/patch-batch`, { method: "POST", body: JSON.stringify({ items }) }));
    }),
  );

program
  .command("transition <trackingCode> <toStatusCode>")
  .description("정의된 전이 규칙에 따라 문서 상태를 바꾼다 - 응답에 본문은 없음(전이는 본문을 안 건드림), updatedAt으로 변경 여부만 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
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
  .command("transition-bulk <toStatusCode> <trackingCodes...>")
  .description("여러 문서를 한 번에 같은 상태로 전이한다 - 항목별 결과를 반환(일부만 실패해도 나머지는 계속 진행)")
  .action((toStatusCode, trackingCodes) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/bulk-transition`, {
          method: "POST",
          body: JSON.stringify({ trackingCodes, toStatusCode }),
        }),
      ),
    ),
  );

program
  .command("priority-set <trackingCode> <n>")
  .description("문서 우선순위(정수)를 설정/갱신한다 - 문서 상태가 review 또는 pending일 때만 가능. 응답에 본문은 없음(우선순위 설정은 본문을 안 건드림), updatedAt으로 변경 여부만 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
  .action((trackingCode, n) =>
    run(async () => {
      const priority = Number(n);
      if (!Number.isInteger(priority)) throw new Error("n은 정수여야 합니다");
      printJson(
        await apiCall(`/api/documents/${trackingCode}/priority`, {
          method: "PUT",
          body: JSON.stringify({ priority }),
        }),
      );
    }),
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
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((trackingCode, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/documents/${trackingCode}/backlinks${paged ? "/page" : ""}${qs}`));
    }),
  );

program
  .command("links-out <trackingCode>")
  .description("이 문서가 링크한 문서들을 순서대로 조회한다(report/여러 문서를 엮은 챕터 구조 확인용) - backlinks(역참조)의 정방향 짝")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/links`))));

program
  .command("unlink <fromTrackingCode> <toTrackingCode>")
  .option("--type <linkType>", "같은 대상으로의 링크가 여러 개(서로 다른 linkType)일 때만 필요")
  .action((from, to, opts) =>
    run(async () => {
      const qs = opts.type ? `?linkType=${encodeURIComponent(opts.type)}` : "";
      printJson(await apiCall(`/api/documents/${from}/links/${to}${qs}`, { method: "DELETE" }));
    }),
  );

program
  .command("links-reorder <trackingCode> <orderedTrackingCodes...>")
  .description("이 문서가 링크한 문서들의 순서를 바꾼다 - 현재 링크 대상 집합과 정확히 같은 순열이어야 한다(누락/추가 불가)")
  .action((trackingCode, orderedTrackingCodes) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${trackingCode}/links/reorder`, {
          method: "PUT",
          body: JSON.stringify({ orderedTrackingCodes }),
        }),
      ),
    ),
  );

program
  .command("doc-graph <projectId>")
  .description("이 프로젝트의 문서 간 링크(DocumentLink) 전체를 그래프(nodes/edges)로 조회한다 - 웹 UI '문서간 관계' 서브탭이 쓰는 것과 같은 데이터")
  .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/document-graph`))));

program
  .command("revisions <trackingCode>")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((trackingCode, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/documents/${trackingCode}/revisions${paged ? "/page" : ""}${qs}`));
    }),
  );

program
  .command("read <trackingCode>")
  .description("문서 본문을 줄 단위로 부분 읽기(큰 문서를 전체로 안 올리고 필요한 범위만) - 둘 다 생략하면 처음 2000줄")
  .option("--offset <n>", "시작 줄 번호(1부터)")
  .option("--limit <n>", "최대 줄 수")
  .action((trackingCode, opts) =>
    run(async () => {
      const qs = new URLSearchParams();
      if (opts.offset !== undefined) qs.set("offset", opts.offset);
      if (opts.limit !== undefined) qs.set("limit", opts.limit);
      printJson(await apiCall(`/api/documents/${trackingCode}/lines${qs.toString() ? `?${qs}` : ""}`));
    }),
  );

program
  .command("grep <trackingCode> <pattern>")
  .description("문서 본문을 정규식(POSIX ERE)으로 줄 단위 검색 - 매치된 줄 번호+텍스트 배열, 패턴이 잘못되면 에러")
  .option("--case-insensitive", "대소문자 구분 안 함")
  .option("--context <n>", "매치된 줄 앞뒤로 n줄씩 더 포함(grep -C와 동일)")
  .action((trackingCode, pattern, opts) =>
    run(async () => {
      const qs = new URLSearchParams({ q: pattern });
      if (opts.caseInsensitive) qs.set("caseInsensitive", "true");
      if (opts.context !== undefined) qs.set("context", opts.context);
      printJson(await apiCall(`/api/documents/${trackingCode}/grep?${qs}`));
    }),
  );

program
  .command("diff <trackingCode> <from> [to]")
  .description("두 시점의 본문을 줄 단위로 비교 - from/to는 `docs revisions`의 리비전 id 또는 리터럴 \"current\"(지금 본문). to 생략 시 current")
  .action((trackingCode, from, to) =>
    run(async () => {
      const qs = new URLSearchParams({ from, ...(to ? { to } : {}) });
      printJson(await apiCall(`/api/documents/${trackingCode}/diff?${qs}`));
    }),
  );

// ---------------------------------------------------------------- 챕터(헤딩 섹션) CRUD
// 긴 문서를 매번 전체 본문으로 안 읽고/안 덮어써도 되도록 - 챕터는
// 마크다운 헤딩(#~######) 하나 + 그 하위 헤딩들의 내용까지를 가리키고,
// 번호(ordinal)는 매번 본문에서 새로 계산되는 1-based 순번이다(제목
// 텍스트가 아님 - 중복 제목이 있어도 항상 명확).
const chapterCmd = program.command("chapter").description("문서 본문의 섹션(헤딩) 단위 CRUD - 긴 문서를 전체로 안 읽고/안 덮어써도 되게");

chapterCmd
  .command("list <trackingCode>")
  .description("챕터 목록(번호/레벨/제목/줄 범위) - 본문 없이 목차만")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/chapters`))));

chapterCmd
  .command("get <trackingCode> <ordinal>")
  .description("특정 챕터의 내용만 조회(하위 헤딩 포함)")
  .action((trackingCode, ordinal) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/chapters/${ordinal}`))));

chapterCmd
  .command("set <trackingCode> <ordinal> <file>")
  .description("특정 챕터의 내용을 로컬 파일 내용으로 통째로 교체(파일은 헤딩 줄 자체를 포함해야 함) - 응답에 본문 없음, 갱신된 챕터 목록만")
  .action((trackingCode, ordinal, file) =>
    run(async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
      printJson(
        await apiCall(`/api/documents/${trackingCode}/chapters/${ordinal}`, { method: "PUT", body: JSON.stringify({ content }) }),
      );
    }),
  );

chapterCmd
  .command("add <trackingCode> <file>")
  .description("새 챕터를 삽입(파일은 헤딩 줄 자체를 포함해야 함) - after/before/at-start/at-end 중 정확히 하나 필요")
  .option("--after <ordinal>", "이 챕터 번호 바로 뒤에 삽입")
  .option("--before <ordinal>", "이 챕터 번호 바로 앞에 삽입")
  .option("--at-start", "문서 맨 앞에 삽입")
  .option("--at-end", "문서 맨 끝에 삽입")
  .action((trackingCode, file, opts) =>
    run(async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
      const body: Record<string, unknown> = { content };
      if (opts.after !== undefined) body.after = Number(opts.after);
      else if (opts.before !== undefined) body.before = Number(opts.before);
      else if (opts.atStart) body.atStart = true;
      else if (opts.atEnd) body.atEnd = true;
      else throw new Error("--after|--before|--at-start|--at-end 중 하나가 필요합니다");
      printJson(await apiCall(`/api/documents/${trackingCode}/chapters`, { method: "POST", body: JSON.stringify(body) }));
    }),
  );

chapterCmd
  .command("delete <trackingCode> <ordinal>")
  .description("챕터를 삭제한다(문서에 챕터가 하나뿐이면 거부)")
  .action((trackingCode, ordinal) =>
    run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/chapters/${ordinal}`, { method: "DELETE" }))),
  );

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
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((trackingCode, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/documents/${trackingCode}/source-links${paged ? "/page" : ""}${qs}`));
    }),
  );

// ---------------------------------------------------------------- 연관된 브랜치

program
  .command("link-branch <trackingCode> <branchName>")
  .description("이 문서와 연관된 git 브랜치를 연결한다(브랜치가 나중에 삭제돼도 이 연결은 유지됨)")
  .action((trackingCode, branchName) =>
    run(async () =>
      printJson(
        await apiCall(`/api/documents/${trackingCode}/branch-links`, {
          method: "POST",
          body: JSON.stringify({ branchName }),
        }),
      ),
    ),
  );

program
  .command("unlink-branch <trackingCode> <linkId>")
  .description("연결된 브랜치 링크를 제거한다")
  .action((trackingCode, linkId) =>
    run(async () =>
      printJson(
        await apiCall(`/api/document-branch-links/${linkId}?trackingCode=${encodeURIComponent(trackingCode)}`, {
          method: "DELETE",
        }),
      ),
    ),
  );

program
  .command("branch-links <trackingCode>")
  .description("이 문서와 연관된 브랜치 목록")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((trackingCode, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/documents/${trackingCode}/branch-links${paged ? "/page" : ""}${qs}`));
    }),
  );

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

// ---------------------------------------------------------------- 칸반 보드
// 코멘트/폴더와 달리 이 기능은 AI에게 완전히 노출된다 - 컬럼 순서/숨김
// 변경과 카드 코멘트만 예외로 CLI/MCP에 없다(개인 UI 설정이거나
// 설계자간 채널).

program
  .command("kanban-columns <projectId>")
  .description("이 프로젝트의 칸반 분류 목록(순서/숨김은 이 계정 기준)")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/kanban/columns${paged ? "/page" : ""}${qs}`));
    }),
  );

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
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = new URLSearchParams({
        ...(opts.column ? { columnId: opts.column } : {}),
        ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
      });
      const suffix = paged ? "/page" : "";
      printJson(await apiCall(`/api/projects/${projectId}/kanban/cards${suffix}${qs.toString() ? `?${qs}` : ""}`));
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
  .description("여러 문서를 링크로 엮는 보고서를 생성한다 - 응답에 본문은 없음(호출자가 이미 보낸 내용), 본문이 필요하면 get/read/grep으로 이어서 조회한다")
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

// ---------------------------------------------------------------- 보류 계획
// Document/DocType/DocStatus 체계와 완전히 별도로 관리되는 독립
// 엔티티(core/plans.ts 참고) - Claude가 작업 중 "이건 나중에 따로
// 계획을 잡아야 한다"고 판단한 항목을 모아두는 체크리스트.

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
      const fs = await import("node:fs");
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
        const fs = await import("node:fs");
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

// ---------------------------------------------------------------- 질의/답변 (pending/reply)
// targetType/targetKey로 다형화됨(document/source/kanbanCard) - document/
// kanbanCard 대상은 그 자신의 트래킹 코드만으로 서버가 대상 종류를
// 자동 판별하므로(resolveTargetByTrackingCode) 기존 2-인자 시그니처를
// 그대로 쓴다. source 대상은 트래킹 코드가 없어 별도 명령이 필요하다.

program
  .command("question <trackingCode> <text...>")
  .option("--kind <approval|answer>", "승인 요청 또는 답변 요청(기본: answer)")
  .option("--refs <codes>", "판단에 참고한 문서 trackingCode 목록(쉼표로 구분)")
  .option(
    "--choices <options>",
    "제안 선택지 목록 - 선택지끼리는 ;;로, 한 선택지 안 라벨/부가정보는 :::로 구분(예: \"A:::설명A;;B:::설명B\")",
  )
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
            options: parseChoices(opts.choices),
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
  .option(
    "--choices <options>",
    "제안 선택지 목록 - 선택지끼리는 ;;로, 한 선택지 안 라벨/부가정보는 :::로 구분(예: \"A:::설명A;;B:::설명B\")",
  )
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
            options: parseChoices(opts.choices),
          }),
        }),
      ),
    ),
  );

program
  .command("questions <trackingCode>")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .option("--status <s>", "open|pending|resolved|withdrawn|active|all(기본 active - 이미 처리된(resolved/withdrawn) 질의는 빼고 아직 처리 안 끝난 것만)")
  .action((trackingCode, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      if (paged) {
        const qs = new URLSearchParams({ trackingCode, page: opts.page ?? "1", pageSize: opts.count ?? "20", ...(opts.status ? { status: opts.status } : {}) });
        printJson(await apiCall(`/api/questions/page?${qs}`));
        return;
      }
      const qs = new URLSearchParams({ trackingCode, ...(opts.status ? { status: opts.status } : {}) });
      printJson(await apiCall(`/api/questions?${qs}`));
    }),
  );

program
  .command("questions-source <projectId> <path>")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .option("--status <s>", "open|pending|resolved|withdrawn|active|all(기본 active - 이미 처리된(resolved/withdrawn) 질의는 빼고 아직 처리 안 끝난 것만)")
  .action((projectId, path, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      if (paged) {
        const qs = new URLSearchParams({ path, page: opts.page ?? "1", pageSize: opts.count ?? "20", ...(opts.status ? { status: opts.status } : {}) });
        printJson(await apiCall(`/api/projects/${projectId}/questions/source/page?${qs}`));
        return;
      }
      const qs = new URLSearchParams({ path, ...(opts.status ? { status: opts.status } : {}) });
      printJson(await apiCall(`/api/projects/${projectId}/questions/source?${qs}`));
    }),
  );

program
  .command("question-ack <trackingCode>")
  .description("설계자가 답변한(pending) 질의를 확인 완료(resolved)로 표시")
  .action((trackingCode) =>
    run(async () => printJson(await apiCall(`/api/questions/${trackingCode}/ack`, { method: "POST" }))),
  );

program
  .command("question-ack-bulk <trackingCodes...>")
  .description("여러 pending 질의를 한 번에 확인 완료로 표시 - 항목별 결과를 반환(일부만 실패해도 나머지는 계속 진행)")
  .action((trackingCodes) =>
    run(async () =>
      printJson(await apiCall(`/api/questions/bulk-ack`, { method: "POST", body: JSON.stringify({ trackingCodes }) })),
    ),
  );

program
  .command("question-withdraw <trackingCode>")
  .description("본인이 등록한 질문 중 아직 답변되지 않은(open) 것을 철회한다")
  .action((trackingCode) =>
    run(async () => printJson(await apiCall(`/api/questions/${trackingCode}/withdraw`, { method: "POST" }))),
  );

program
  .command("pending <projectId>")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/pending${paged ? "/page" : ""}${qs}`));
    }),
  );

program
  .command("dashboard <projectId>")
  .description(
    "프로젝트 진행 상황 요약(문서 상태 분포+정체 문서, 미답변 Q&A, 처리 안 된 메시지, 칸반 컬럼별 카드 수, 최근 활동) - 웹 홈 화면과 같은 데이터",
  )
  .option("--stale-days <n>", "며칠 이상 안 바뀌면 '정체 문서'로 볼지(기본 14)")
  .action((projectId, opts) =>
    run(async () => {
      const qs = opts.staleDays !== undefined ? `?staleDays=${opts.staleDays}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/dashboard${qs}`));
    }),
  );

program
  .command("activity <projectId>")
  .description("프로젝트 최근 활동 전체 목록(문서 생성/수정, 질의, 답변, 코멘트, 메시지, 칸반 카드 생성) - 대시보드의 최근 활동(20건 고정) 더보기용, 기본 100건")
  .option("--limit <n>", "최대 건수(기본 100)")
  .action((projectId, opts) =>
    run(async () => {
      const qs = opts.limit !== undefined ? `?limit=${opts.limit}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/activity${qs}`));
    }),
  );

program
  .command("reply <questionTrackingCode> [answer...]")
  .description("답변 요청(kind=answer)은 answer 텍스트로 답한다. 승인 요청(kind=approval)은 --decision으로 승인/거부를 확정하거나(answer 텍스트를 메모로 같이 붙일 수 있음), 아직 결정하기 전이면 --decision 없이 answer 텍스트만으로도 답할 수 있다(둘 중 최소 하나 필요)")
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

gitCmd
  .command("unlink <projectId>")
  .description(
    "외부 연동(link-external)의 권위 저장소 관계만 끊는다 - Gitea 작업 저장소는 그대로 남아 self_hosted로 전환된다(자체 호스팅 저장소는 해제 불가 - 프로젝트 삭제만 가능)",
  )
  .action((projectId) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/git/repo`, { method: "DELETE" }))),
  );

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

// ---------------------------------------------------------------- git push 훅 프롬프트 자동화 (Phase 3 - 대기열 방식)

const hookCmd = program.command("hook").description("git push 훅 프롬프트 자동화(대기열)");

hookCmd
  .command("create <projectId>")
  .requiredOption("--prompt <file>", "프롬프트 내용이 담긴 로컬 파일")
  .option("--branch <branch>", '이 브랜치로 push될 때만 매칭(생략하면 모든 브랜치) - "release/*"처럼 *로 브랜치 그룹을 묶을 수 있다(세그먼트 안에서만 - /는 안 넘음)')
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
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) =>
    run(async () => {
      const paged = opts.page !== undefined || opts.count !== undefined;
      const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
      printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts${paged ? "/page" : ""}${qs}`));
    }),
  );

hookCmd
  .command("update <projectId> <id>")
  .option("--prompt <file>", "새 프롬프트 내용이 담긴 로컬 파일(생략하면 기존 내용 유지)")
  .option("--branch <branch>", '새 트리거 브랜치("release/*"처럼 *로 그룹 매칭 가능, --branch="" 처럼 빈 문자열을 주면 브랜치 제한 해제 - 모든 브랜치 매칭, 생략하면 기존 값 유지 - 공백으로 띄어 쓴 --branch ""는 셸/commander가 값 누락으로 처리하니 반드시 =로 붙여 쓸 것)')
  .action((projectId, id, opts) =>
    run(async () => {
      const body: { promptTemplate?: string; triggerBranch?: string } = {};
      if (opts.prompt !== undefined) {
        const fs = await import("node:fs");
        body.promptTemplate = fs.readFileSync(opts.prompt, "utf-8");
      }
      if (opts.branch !== undefined) body.triggerBranch = opts.branch;
      printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts/${id}`, { method: "PUT", body: JSON.stringify(body) }));
    }),
  );

hookCmd
  .command("delete <projectId> <id>")
  .action((projectId, id) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-prompts/${id}`, { method: "DELETE" }))),
  );

hookCmd
  .command("queue <projectId>")
  .option("--status <s>", "pending|acknowledged|done|expired(생략하면 전체) - pending으로 30일 넘게 방치된 항목은 자동으로 expired 처리됨")
  .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .action((projectId, opts) => {
    const paged = opts.page !== undefined || opts.count !== undefined;
    const qs = new URLSearchParams({
      ...(opts.status ? { status: opts.status } : {}),
      ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
    });
    const suffix = paged ? "/page" : "";
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/push-hook-queue${suffix}${qs.toString() ? `?${qs}` : ""}`)));
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

const messageCmd = program.command("message").description("인스턴스 메시징 - 대기(미확인)/처리중(ack함)/기록(complete함) 상태 구분");
messageCmd
  .command("list <projectId>")
  .option("--status <s>", "pending|processing|delivered|active|all(기본 active - 기록/완료된 메시지는 빼고 아직 처리 안 끝난 것만)")
  .option("--origin <o>", "designer|ai - 생략하면 방향 구분 없이 전체(#message-origin-tagging, CLI/MCP로 보낸 메시지는 자동으로 ai)")
  .option(
    "--page <n>",
    "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열. 주의: 페이지네이션 응답에선 deliveredAt 자동 갱신이 안 됨(웹 화면과 공유하는 라우트라 markDelivered 미지원)",
  )
  .option("--count <n>", "페이지당 개수(--page와 함께)")
  .description(
    "CLI로 조회해도 상태는 안 바뀐다(읽음은 ack와 별개) - 대기 상태였던 메시지의 deliveredAt만 자동 갱신. " +
      "--status를 생략하면 기본으로 active(대기+처리중)만 보여주고 기록(완료)된 메시지는 안 보낸다 - 전체 이력이 필요하면 --status all.",
  )
  .action((projectId, opts) => {
    const status = opts.status ?? "active";
    const paged = opts.page !== undefined || opts.count !== undefined;
    if (paged) {
      const qs = new URLSearchParams({ status, page: opts.page ?? "1", pageSize: opts.count ?? "20", ...(opts.origin ? { origin: opts.origin } : {}) });
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/page?${qs}`)));
    }
    const qs = new URLSearchParams({ markDelivered: "true", status, ...(opts.origin ? { origin: opts.origin } : {}) });
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages?${qs}`)));
  });
messageCmd
  .command("send <projectId> <body...>")
  .description("이 명령으로 보낸 메시지는 origin이 자동으로 ai로 기록된다(#message-origin-tagging - CLI는 항상 X-Client-Kind: cli를 붙이는 공유 클라이언트를 거침)")
  .action((projectId, bodyParts) =>
    run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify({ body: bodyParts.join(" ") }) }))),
  );
messageCmd
  .command("wait <projectId>")
  .option("--timeout <sec>", "전체 대기 시간(초) - EMQX 직접 구독이 가능하면 그걸로 대기하고, 안 되면 10초 단위 HTTP 폴링으로 자동 폴백", "60")
  .action((projectId, opts) => run(async () => printJson(await waitForMessageDirect(projectId, Number(opts.timeout)))));
messageCmd
  .command("recent <projectId>")
  .option("--limit <n>", "기본 20")
  .description("장애 복구용 - 상태를 바꾸지 않는 순수 조회(반복 호출해도 안전), 대기/기록 구분 없이 최신순")
  .action((projectId, opts) => {
    const qs = opts.limit ? `?limit=${encodeURIComponent(opts.limit)}` : "";
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/recent${qs}`)));
  });
messageCmd
  .command("edit <id> <body...>")
  .description("본인이 보낸 메시지만 수정할 수 있다")
  .action((id, bodyParts) =>
    run(async () =>
      printJson(await apiCall(`/api/messages/${id}`, { method: "PUT", body: JSON.stringify({ body: bodyParts.join(" ") }) })),
    ),
  );
messageCmd
  .command("delete <id>")
  .description("본인이 보낸 메시지만 삭제할 수 있다")
  .action((id) => run(async () => printJson(await apiCall(`/api/messages/${id}`, { method: "DELETE" }))));
messageCmd
  .command("ack <id>")
  .description("대기 → 처리중으로 표시(프로젝트 멤버 누구나 가능, 이미 처리중/기록이면 그대로)")
  .action((id) => run(async () => printJson(await apiCall(`/api/messages/${id}/ack`, { method: "PUT" }))));
messageCmd
  .command("complete <id>")
  .description("처리중 → 기록으로 표시(ack 없이 불러도 자동으로 ack까지 됨, 이미 기록이면 그대로)")
  .action((id) => run(async () => printJson(await apiCall(`/api/messages/${id}/complete`, { method: "PUT" }))));

// ---------------------------------------------------------------- 세션/동시 작업 등록 (SP-976DD4ED, #multi-session-workclaim)
// 계정 전체 스코프 - 같은 계정으로 여러 Claude 세션을 동시에 띄울 때
// 서로를 구분하고(X-Session-Id 헤더는 apiFetch()가 이미 자동으로
// 붙임, 이 명령들은 새 인자를 요구하지 않음) "지금 뭘 작업 중인지"를
// 광고판처럼 등록해 다른 세션에 알린다 - 락이 아니라 경고용(WorkClaim
// 이 있어도 실제 저장/전이는 그대로 진행되고, 관련 mutation 응답의
// notices에 경고만 뜬다).

const sessionCmd = program.command("session").description("같은 계정의 다른 Claude 세션 목록/이름(SP-976DD4ED)");
sessionCmd
  .command("list")
  .option("--minutes <n>", "최근 이 분(minute) 안에 활동한 세션만(생략하면 전체)")
  .description("내 계정의 세션 목록 - 이름/클라이언트 종류/마지막 활동 시각")
  .action((opts) => {
    const qs = opts.minutes ? `?minutes=${encodeURIComponent(opts.minutes)}` : "";
    return run(async () => printJson(await apiCall(`/api/sessions${qs}`)));
  });
sessionCmd
  .command("rename <sessionId> <name>")
  .description("내 세션(본인 소유만) 이름을 바꾼다 - 다른 세션 이름은 못 바꿈")
  .action((sessionId, name) =>
    run(async () => printJson(await apiCall(`/api/sessions/${sessionId}/name`, { method: "PUT", body: JSON.stringify({ name }) }))),
  );
sessionCmd
  .command("project <projectId>")
  .option("--page <n>", "페이지 번호(1부터, 기본 1)")
  .option("--count <n>", "페이지당 개수(기본 20)")
  .description("이 프로젝트에서 활동한 적 있는 세션들 - 어떤 설계자의 어떤 세션인지, 최근 활동순")
  .action((projectId, opts) => {
    const qs = new URLSearchParams({ page: opts.page ?? "1", pageSize: opts.count ?? "20" });
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/sessions/page?${qs}`)));
  });

const workCmd = program.command("work").description("현재 작업 중인 대상 등록(WorkClaim) - 락 아님, 경고용(SP-976DD4ED)");
workCmd
  .command("claim <projectId> <targetType> <targetKey>")
  .description("targetType: document|plan|sourceFile - 이 대상을 지금 작업 중이라고 등록(명시적으로 부를 때만 생김)")
  .action((projectId, targetType, targetKey) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/work-claims`, { method: "POST", body: JSON.stringify({ targetType, targetKey }) }),
      ),
    ),
  );
workCmd
  .command("release <projectId> <targetType> <targetKey>")
  .description("claim 해제(작업이 끝났거나 더 이상 유효하지 않을 때)")
  .action((projectId, targetType, targetKey) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/work-claims`, { method: "DELETE", body: JSON.stringify({ targetType, targetKey }) }),
      ),
    ),
  );
workCmd
  .command("list <projectId>")
  .option("--minutes <n>", "이 분(minute) 안에 활동한 세션의 클레임만(기본 30분)")
  .description("이 프로젝트에서 지금 살아있는 세션들이 뭘 작업 중인지")
  .action((projectId, opts) => {
    const qs = opts.minutes ? `?minutes=${encodeURIComponent(opts.minutes)}` : "";
    return run(async () => printJson(await apiCall(`/api/projects/${projectId}/work-claims${qs}`)));
  });

// ---------------------------------------------------------------- 검색 엔진 장애 대응 큐 (관리자 전용)

const searchQueueCmd = program.command("search-queue").description("Meilisearch 장애 시 밀린 색인 동기화 큐(관리자 전용)");
searchQueueCmd
  .command("status")
  .description("큐 상태 조회 - 30초 주기 워커가 자동으로 비우지만, 장애 해소를 확인하는 용도")
  .action(() => run(async () => printJson(await apiCall("/api/admin/search-queue"))));
searchQueueCmd
  .command("drain")
  .description("큐를 즉시 일괄 재처리 - 워커 주기를 기다리지 않고 바로 비우고 싶을 때")
  .action(() => run(async () => printJson(await apiCall("/api/admin/search-queue/drain", { method: "POST" }))));

// ---------------------------------------------------------------- 사용 모니터링(#usage-monitoring)
// "어떤 요청/명령/흐름이 자주 목격되는지" - 어떤 기능을 유지/보완/
// 수정/추가할지 판단하는 용도. raw route가 아니라 CLI/MCP 명령
// 이름으로 라벨링돼 나온다(매핑 없는 라우트는 raw로 그대로).

const monitoringCmd = program.command("monitoring").description("사용 통계(명령 빈도 + 연이은 패턴) - 어떤 기능을 유지/보완/추가할지 판단하는 용도");

monitoringCmd
  .command("stats <projectId>")
  .description("이 프로젝트의 명령 사용 빈도 + 연이은 패턴(A 다음 B) 통계")
  .option("--limit <n>", "상위 몇 건까지(기본 20)")
  .option("--all", "전체(제한 없이)")
  .action((projectId, opts) =>
    run(async () => {
      const qs = new URLSearchParams({ limit: opts.all ? "100000" : (opts.limit ?? "20") });
      printJson(await apiCall(`/api/projects/${projectId}/monitoring/stats?${qs}`));
    }),
  );

monitoringCmd
  .command("stats-all")
  .description("설치 전체 통계(모든 프로젝트 합산) - superAdmin 전용")
  .option("--limit <n>", "상위 몇 건까지(기본 20)")
  .option("--all", "전체(제한 없이)")
  .action((opts) =>
    run(async () => {
      const qs = new URLSearchParams({ limit: opts.all ? "100000" : (opts.limit ?? "20") });
      printJson(await apiCall(`/api/monitoring/stats?${qs}`));
    }),
  );

// ---------------------------------------------------------------- 가이디드 마이그레이션 (Phase 6)

const migrateCmd = program.command("migrate").description("파일 기반(concept 스타일) 프로젝트를 DB로 옮기기");

migrateCmd
  .command("scan <sourceDir>")
  .description("sourceDir를 스캔해 후보 목록을 JSON으로 출력(리다이렉트해 매니페스트로 씀) - 흔한 옛 상태 어휘(active/wip 등)를 표준 코드로 자동 제안한다")
  .option("--no-status-preset", "상태 어휘 자동 제안을 끄고 frontmatter 값을 그대로 둔다")
  .action((sourceDir, opts) => run(async () => printJson(scanDirectory(sourceDir, { applyStatusPreset: opts.statusPreset }))));

migrateCmd
  .command("apply <projectId> <manifestFile>")
  .description("검토·수정한 매니페스트를 실제로 반영")
  .action((projectId, manifestFile) => run(async () => printJson(await applyManifest(projectId, manifestFile))));

const cacheCmd = program.command("cache").description("작업 폴더에 문서를 파일로 내려받아두는 로컬 캐시(#document-cache-export)");

cacheCmd
  .command("sync <projectId> [dir]")
  .description("이 프로젝트의 전체 문서를 dir(기본 docs)에 trackingCode.md 파일+index.md로 내려쓰고, 삭제된 문서의 캐시 파일은 정리한다 - 정본은 항상 DB, 이 캐시는 읽기 전용 사본")
  .action((projectId, dir) => run(async () => printJson(await syncDocumentCache(projectId, dir ?? "docs"))));

cacheCmd
  .command("clean [dir]")
  .description("dir(기본 docs) 안에서 이 명령이 만든 것으로 알아볼 수 있는 캐시 파일만 지운다(디렉터리 자체나 무관한 파일은 안 건드림)")
  .action((dir) => run(async () => printJson(cleanDocumentCache(dir ?? "docs"))));

program.parse();
