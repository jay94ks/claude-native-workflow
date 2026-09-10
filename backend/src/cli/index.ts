#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { apiCall, apiCallText, saveCredentials, loadCredentials, clearCredentials, credentialsPath } from "./apiclient.js";
import { scanDirectory, applyManifest } from "./migrate.js";

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
  .command("institution-doctype-create <institutionId> <code> <label>")
  .option("--guideline <text>", "이 타입은 무엇을 하기 위한 것인지(선택)")
  .action((institutionId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/institutions/${institutionId}/doc-types`, {
          method: "POST",
          body: JSON.stringify({ code, label, guideline: opts.guideline }),
        }),
      ),
    ),
  );

program
  .command("institution-doctypes <institutionId>")
  .action((institutionId) => run(async () => printJson(await apiCall(`/api/institutions/${institutionId}/doc-types`))));

program
  .command("institution-doctype-guideline-set <institutionId> <docTypeId> <guideline...>")
  .action((institutionId, docTypeId, guidelineParts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/institutions/${institutionId}/doc-types/${docTypeId}/guideline`, {
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
  .command("doctype-status-add <projectId> <docTypeId> <code> <label>")
  .option("--terminal", "이 상태가 종료 상태임을 표시")
  .action((projectId, docTypeId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/projects/${projectId}/doc-types/${docTypeId}/statuses`, {
          method: "POST",
          body: JSON.stringify({ code, label, isTerminal: !!opts.terminal }),
        }),
      ),
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
  .command("institution-doctype-status-add <institutionId> <docTypeId> <code> <label>")
  .option("--terminal", "이 상태가 종료 상태임을 표시")
  .action((institutionId, docTypeId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/institutions/${institutionId}/doc-types/${docTypeId}/statuses`, {
          method: "POST",
          body: JSON.stringify({ code, label, isTerminal: !!opts.terminal }),
        }),
      ),
    ),
  );

program
  .command("institution-doctype-transition-add <institutionId> <docTypeId> <fromCode> <toCode>")
  .option("--label <l>", "전이 라벨(선택)")
  .action((institutionId, docTypeId, fromCode, toCode, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/institutions/${institutionId}/doc-types/${docTypeId}/transitions`, {
          method: "POST",
          body: JSON.stringify({ fromStatusCode: fromCode, toStatusCode: toCode, label: opts.label }),
        }),
      ),
    ),
  );

program
  .command("group-doctype-status-add <groupId> <docTypeId> <code> <label>")
  .option("--terminal", "이 상태가 종료 상태임을 표시")
  .action((groupId, docTypeId, code, label, opts) =>
    run(async () =>
      printJson(
        await apiCall(`/api/project-groups/${groupId}/doc-types/${docTypeId}/statuses`, {
          method: "POST",
          body: JSON.stringify({ code, label, isTerminal: !!opts.terminal }),
        }),
      ),
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
  .command("questions <trackingCode>")
  .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/questions`))));

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

const messageCmd = program.command("message").description("인스턴스 메시징(Phase 4에서 구현)");
messageCmd.command("list <projectId>").action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`))));
messageCmd.command("send <projectId> <body...>").action((projectId, bodyParts) =>
  run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify({ body: bodyParts.join(" ") }) }))),
);
messageCmd
  .command("wait <projectId>")
  .option("--timeout <sec>", "타임아웃(초)", "60")
  .action((projectId, opts) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/wait?timeout=${opts.timeout}`))));

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
