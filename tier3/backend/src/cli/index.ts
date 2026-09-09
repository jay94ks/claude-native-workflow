#!/usr/bin/env node
import { Command } from "commander";
import { saveCredentials, loadCredentials, clearCredentials, credentialsPath } from "../core/credentials.js";
import { apiCall } from "../core/apiclient.js";

// SP-00002 2절 "Skill이 안내하는 얇은 REST 클라이언트" - tier2의 docs CLI와
// 달리 core를 직접 호출하지 않는다(로컬 파일이 없다 - 서버가 어딘가
// 원격에 떠 있고, 이 CLI는 그 REST API를 호출하는 클라이언트일 뿐).

const program = new Command();
program.name("docs3").description("claude-native-workflow 고급(Tier 3) REST 클라이언트");

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

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
  .command("tree <projectId>")
  .description("문서 트리 조회")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/tree`)));

program
  .command("doc <projectId> <path>")
  .description("문서 1건 조회")
  .action(async (projectId: string, path: string) => printJson(await apiCall(`/api/projects/${projectId}/doc?path=${encodeURIComponent(path)}`)));

program
  .command("pending <projectId>")
  .description("답변 대기 목록")
  .action(async (projectId: string) => printJson(await apiCall(`/api/projects/${projectId}/pending`)));

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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
