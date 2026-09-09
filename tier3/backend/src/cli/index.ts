#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { saveCredentials, loadCredentials, clearCredentials, credentialsPath } from "../core/credentials.js";
import { apiCall, apiCallText } from "../core/apiclient.js";

// SP-00002 2절 "Skill이 안내하는 얇은 REST 클라이언트" - tier2의 docs CLI와
// 달리 core를 직접 호출하지 않는다(로컬 파일이 없다 - 서버가 어딘가
// 원격에 떠 있고, 이 CLI는 그 REST API를 호출하는 클라이언트일 뿐).

const program = new Command();
program.name("docs3").description("claude-native-workflow 고급(Tier 3) REST 클라이언트");

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

program
  .command("register")
  .description("계정 생성(가입 후 별도로 docs3 login 필요)")
  .requiredOption("--api <url>", "Tier 3 서버 주소, 예: https://docs3.example.com")
  .requiredOption("--username <username>", "아이디")
  .requiredOption("--email <email>", "이메일")
  .option("--password <password>", "비밀번호(생략 시 DOCS3_PASSWORD 환경변수 사용)")
  .action(async (opts: { api: string; username: string; email: string; password?: string }) => {
    const password = opts.password ?? process.env.DOCS3_PASSWORD;
    if (!password) {
      console.error("--password 또는 DOCS3_PASSWORD 환경변수가 필요합니다");
      process.exitCode = 1;
      return;
    }
    const apiBase = opts.api.replace(/\/+$/, "");
    const res = await fetch(`${apiBase}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: opts.username, email: opts.email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      console.error(body.error ?? `HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    printJson(await res.json());
    console.log("가입 완료 - docs3 login으로 로그인하세요.");
  });

program
  .command("login")
  .description("로그인하고 토큰을 홈 디렉터리에 저장")
  .requiredOption("--api <url>", "Tier 3 서버 주소, 예: https://docs3.example.com")
  .requiredOption("--username <username>", "아이디 또는 이메일")
  .option("--password <password>", "비밀번호(생략 시 DOCS3_PASSWORD 환경변수 사용)")
  .action(async (opts: { api: string; username: string; password?: string }) => {
    const password = opts.password ?? process.env.DOCS3_PASSWORD;
    if (!password) {
      console.error("--password 또는 DOCS3_PASSWORD 환경변수가 필요합니다");
      process.exitCode = 1;
      return;
    }
    const apiBase = opts.api.replace(/\/+$/, "");
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: opts.username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      console.error(body.error ?? `HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    const { access_token, refresh_token } = (await res.json()) as { access_token: string; refresh_token: string };
    saveCredentials({ api_base: apiBase, access_token, refresh_token });
    console.log(`로그인 완료 - 토큰을 ${credentialsPath()}에 저장했습니다(권한 600).`);
  });

program
  .command("logout")
  .description("서버에서 refresh token을 폐기하고 로컬 저장 토큰을 지움")
  .action(async () => {
    const creds = loadCredentials();
    if (creds) {
      await fetch(`${creds.api_base}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: creds.refresh_token }),
      }).catch(() => undefined);
    }
    clearCredentials();
    console.log("로그아웃 완료");
  });

program
  .command("whoami")
  .description("현재 로그인 상태 확인")
  .action(() => {
    const creds = loadCredentials();
    if (!creds) {
      console.log("로그인되어 있지 않습니다");
      return;
    }
    printJson({ api_base: creds.api_base });
  });

program
  .command("projects")
  .description("내가 속한 프로젝트 목록")
  .action(async () => printJson(await apiCall("/api/projects")));

program
  .command("project-create")
  .description("새 프로젝트 등록(생성자가 owner)")
  .requiredOption("--name <name>", "프로젝트 이름")
  .requiredOption("--repo <url>", "git 저장소 URL")
  .action(async (opts: { name: string; repo: string }) =>
    printJson(await apiCall("/api/projects", { method: "POST", body: JSON.stringify({ name: opts.name, git_repo_url: opts.repo }) })),
  );

program
  .command("members <projectId>")
  .description("프로젝트 멤버 목록")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/members`)));

program
  .command("invite <projectId>")
  .description("멤버 초대(owner만)")
  .requiredOption("--email <email>", "초대할 사용자 이메일")
  .requiredOption("--role <role>", "viewer|editor|owner")
  .action(async (projectId: string, opts: { email: string; role: string }) =>
    printJson(await apiCall(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ email: opts.email, role: opts.role }) })),
  );

program
  .command("member-role <projectId> <userId>")
  .description("멤버 역할 변경(owner만)")
  .requiredOption("--role <role>", "viewer|editor|owner")
  .action(async (projectId: string, userId: string, opts: { role: string }) =>
    printJson(await apiCall(`/api/projects/${projectId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role: opts.role }) })),
  );

program
  .command("member-remove <projectId> <userId>")
  .description("멤버 제거(owner만)")
  .action(async (projectId: string, userId: string) =>
    printJson(await apiCall(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" })),
  );

program
  .command("tree <projectId>")
  .description("문서 트리 조회")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/tree`)));

program
  .command("doc <projectId> <path>")
  .description("문서 1건 조회")
  .action(async (projectId: string, path: string) => printJson(await apiCall(`/api/projects/${projectId}/doc?path=${encodeURIComponent(path)}`)));

program
  .command("save <projectId> <path> <file>")
  .description("문서 본문을 로컬 마크다운 파일 내용으로 갱신(POST doc/save)")
  .action(async (projectId: string, path: string, file: string) => {
    const body = fs.readFileSync(file, "utf-8");
    printJson(await apiCall(`/api/projects/${projectId}/doc/save`, {
      method: "POST", body: JSON.stringify({ path, body }),
    }));
  });

program
  .command("pending <projectId>")
  .description("답변 대기 목록")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/pending`)));

program
  .command("design <projectId>")
  .description("DC/RV/FX 목록 조회")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/design`)));

program
  .command("logs <projectId>")
  .description("LG 목록 조회")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/logs`)));

program
  .command("all <projectId>")
  .description("전체 문서 목록 조회")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/all`)));

program
  .command("search <projectId> <query>")
  .description("전문 검색")
  .action(async (projectId: string, query: string) =>
    printJson(await apiCall(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`)),
  );

program
  .command("validate <projectId>")
  .description("docs/ 구조 검증")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/validate`)));

program
  .command("new <projectId> <type>")
  .description("새 문서 생성")
  .requiredOption("--title <title>", "문서 제목")
  .option("--links <ids>", "쉼표로 구분된 links 목록")
  .action(async (projectId: string, type: string, opts: { title: string; links?: string }) => {
    const links = opts.links ? opts.links.split(",").map((s) => s.trim()).filter(Boolean) : [];
    printJson(await apiCall(`/api/projects/${projectId}/docs`, { method: "POST", body: JSON.stringify({ type, title: opts.title, links }) }));
  });

program
  .command("reply <projectId> <path> <questionId> <answer...>")
  .description("답변 대기 질문에 답변")
  .action(async (projectId: string, path: string, questionId: string, answerParts: string[]) =>
    printJson(await apiCall(`/api/projects/${projectId}/docs/${encodeURIComponent(path)}/reply`, {
      method: "POST", body: JSON.stringify({ question_id: questionId, answer: answerParts.join(" ") }),
    })),
  );

program
  .command("transition-done <projectId> <planId>")
  .description("PL -> DN 전환")
  .requiredOption("--report <text>", "완료 결과 보고 내용")
  .action(async (projectId: string, planId: string, opts: { report: string }) =>
    printJson(await apiCall(`/api/projects/${projectId}/plan/${planId}/transition-done`, { method: "POST", body: JSON.stringify({ report: opts.report }) })),
  );

const gitCmd = program.command("git").description("git 동기화(SP-00002 5절)");

gitCmd
  .command("commit <projectId>")
  .description("현재 변경분 커밋(요청자 이름으로) + push")
  .option("-m, --message <text>", "커밋 메시지")
  .action(async (projectId: string, opts: { message?: string }) =>
    printJson(await apiCall(`/api/projects/${projectId}/git/commit`, { method: "POST", body: JSON.stringify({ message: opts.message }) })),
  );

gitCmd
  .command("push <projectId>")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/git/push`, { method: "POST" })));

gitCmd
  .command("pull <projectId>")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/git/pull`, { method: "POST" })));

gitCmd
  .command("log <projectId>")
  .description("docs/ 커밋 이력 조회(읽기 전용)")
  .option("--path <path>", "특정 문서로 한정")
  .option("--limit <n>", "최대 개수", "30")
  .action(async (projectId: string, opts: { path?: string; limit: string }) => {
    const params = new URLSearchParams({ limit: opts.limit });
    if (opts.path) params.set("path", opts.path);
    printJson(await apiCall(`/api/projects/${projectId}/git/log?${params}`));
  });

gitCmd
  .command("blame <projectId> <path>")
  .description("문서 blame 조회(읽기 전용)")
  .action(async (projectId: string, path: string) =>
    console.log(await apiCallText(`/api/projects/${projectId}/git/blame?path=${encodeURIComponent(path)}`)),
  );

gitCmd
  .command("show <projectId> <sha>")
  .description("커밋 1건 상세 조회(읽기 전용)")
  .action(async (projectId: string, sha: string) => printJson(await apiCall(`/api/projects/${projectId}/git/commits/${sha}`)));

gitCmd
  .command("diff <projectId> <sha>")
  .description("커밋 diff 조회(읽기 전용)")
  .action(async (projectId: string, sha: string) =>
    console.log(await apiCallText(`/api/projects/${projectId}/git/diff/${sha}`)),
  );

const commentCmd = program.command("comment").description("문서 코멘트(비공식 토론용, 프로젝트별 공유 서비스 DB)");

commentCmd
  .command("list <projectId> <path>")
  .description("문서의 코멘트 목록 조회")
  .action(async (projectId: string, path: string) =>
    printJson(await apiCall(`/api/projects/${projectId}/docs/${encodeURIComponent(path)}/comments`)),
  );

commentCmd
  .command("add <projectId> <path> <text...>")
  .description("코멘트 작성")
  .action(async (projectId: string, path: string, textParts: string[]) =>
    printJson(await apiCall(`/api/projects/${projectId}/docs/${encodeURIComponent(path)}/comments`, {
      method: "POST", body: JSON.stringify({ body: textParts.join(" ") }),
    })),
  );

commentCmd
  .command("resolve <projectId> <path> <commentId>")
  .description("코멘트 해결 처리")
  .action(async (projectId: string, path: string, commentId: string) =>
    printJson(await apiCall(`/api/projects/${projectId}/docs/${encodeURIComponent(path)}/comments/${commentId}/resolve`, { method: "POST" })),
  );

// tier2의 `docs changes`(인자 없음, 프로젝트가 하나뿐)와 달리 여기는
// projectId가 필요해서 `changes <projectId>`를 그대로 쓰면 `ack`
// 서브커맨드와 위치 인자가 모호해진다 - `list`/`ack` 둘 다 서브커맨드로
// 분리(git/comment 그룹과 같은 패턴).
const changesCmd = program.command("changes").description("변경 추적 큐");

changesCmd
  .command("list <projectId>")
  .description("미확인 변경 목록 조회")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/changes`)));

changesCmd
  .command("ack <projectId> <id>")
  .description("변경 항목을 확인 처리(큐에서 제거)")
  .action(async (projectId: string, id: string) =>
    printJson(await apiCall(`/api/projects/${projectId}/changes/${id}/ack`, { method: "POST" })),
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
