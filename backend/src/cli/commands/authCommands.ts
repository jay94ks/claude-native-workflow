// 배치 2a(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// 인증/프로필/사용자 프로필 조회. cli/index.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜.
import type { Command } from "commander";
import { apiCall, saveCredentials, loadCredentials, clearCredentials, credentialsPath } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerAuthCommands(program: Command): void {
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
}
