// CLI/MCP 대칭성 자동 감사 - PLANS.md #cli-mcp-audit-script.
//
// CLI 쪽은 src/cli/index.ts를 정적으로 파싱해서 구한다 - Commander의
// `program`이 export되지 않고 파일 맨 아래서 무조건 `program.parse()`가
// 실행되기 때문에(cli/index.ts 참고), 빌드된 모듈을 import해서
// `.commands`를 읽는 방법은 못 쓴다. 이 파일의 명령 선언 스타일은 두
// 가지뿐이라(플랫 최상위 `program.command(...)`, 그룹 `const xCmd =
// program.command("group")` + `xCmd.command("sub")`) 정적 파싱만으로
// 충분히 신뢰할 수 있다.
//
// MCP 쪽은 반대로 정적 파싱을 안 한다 - 실제로 서버 프로세스를 띄워
// 표준 `tools/list`를 호출한다. mcp/server.ts의 도구 등록은 완전히
// 선언적이라(DB/REST 호출 없음 - apiCall은 도구가 "호출"될 때만 fetch가
// 발생, "등록" 시점엔 순수 함수 실행뿐) 백엔드/DB 없이도 정확한 답을
// 얻을 수 있고, `git_diff`처럼 tool() 헬퍼를 안 거치고 registerTool을
// 직접 부르는 예외도 자동으로 잡힌다(정적 파싱이었다면 놓쳤을 것).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

function firstToken(s: string): string {
  return s.trim().split(/\s+/)[0];
}

/** CLI 이름 → MCP snake_case 비교 형식("git publish-queue-done" →
 * "git_publish_queue_done", "doctype-create" → "doctype_create"). */
function toTag(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

interface CliExtractResult {
  tags: Set<string>;
  displayNames: Map<string, string>; // tag -> 원래 표시용 이름("group leaf")
}

/** src/cli/index.ts를 정적으로 파싱해 실행 가능한 리프 명령 전체를
 * 구한다(그룹 루트 자신은 제외 - 직접 실행할 수 없으므로). */
function extractCliCommands(): CliExtractResult {
  const source = fs.readFileSync(path.join(backendRoot, "src/cli/index.ts"), "utf-8");

  // 1단계 - 그룹 선언(`const xCmd = program.command("group")`) 수집.
  // 나중에 "program.command(...)" 전체 목록에서 이 위치들은 그룹 루트로
  // 판단해 플랫 명령 집계에서 제외해야 하므로, 그 program.command(...)
  // 부분의 소스상 시작 위치도 같이 기록해둔다.
  const groupVarToName = new Map<string, string>();
  const groupProgramCallIndices = new Set<number>();
  const groupDeclRe = /const\s+(\w+)\s*=\s*(program\s*\.\s*command\(\s*"([^"]+)"\s*\))/g;
  for (const m of source.matchAll(groupDeclRe)) {
    const varName = m[1];
    const groupName = firstToken(m[3]);
    groupVarToName.set(varName, groupName);
    groupProgramCallIndices.add(m.index + m[0].indexOf(m[2]));
  }

  const tags = new Set<string>();
  const displayNames = new Map<string, string>();

  // 2단계 - "program.command(...)" 전체 중 그룹 선언이 아닌 것 = 플랫 명령.
  const programCallRe = /program\s*\.\s*command\(\s*"([^"]+)"\s*\)/g;
  for (const m of source.matchAll(programCallRe)) {
    if (groupProgramCallIndices.has(m.index)) continue;
    const name = firstToken(m[1]);
    const tag = toTag(name);
    tags.add(tag);
    displayNames.set(tag, name);
  }

  // 3단계 - "xCmd.command(...)"에서 xCmd가 알려진 그룹 변수면 "그룹 리프"로 합성.
  const subCallRe = /(\w+)\s*\.\s*command\(\s*"([^"]+)"\s*\)/g;
  for (const m of source.matchAll(subCallRe)) {
    const varName = m[1];
    if (varName === "program") continue; // 위에서 이미 처리
    const groupName = groupVarToName.get(varName);
    if (!groupName) continue; // 그룹 변수가 아니면 무관한 .command() 호출
    const fullName = `${groupName} ${firstToken(m[2])}`;
    const tag = toTag(fullName);
    tags.add(tag);
    displayNames.set(tag, fullName);
  }

  return { tags, displayNames };
}

/** mcp/server.ts를 실제로 자식 프로세스로 띄워(tsx로 직접 실행, npm
 * PATH/셸 shim에 의존하지 않도록 node + tsx의 CLI 진입점(dist/cli.mjs)을
 * 그대로 지정) 표준 tools/list를 호출한다. */
async function fetchMcpToolTags(): Promise<{ tags: Set<string>; displayNames: Map<string, string> }> {
  const tsxCli = path.join(backendRoot, "node_modules/tsx/dist/cli.mjs");
  const serverEntry = path.join(backendRoot, "src/mcp/server.ts");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, serverEntry],
    cwd: backendRoot,
  });
  const client = new Client({ name: "audit-cli-mcp", version: "0.1.0" });

  const TIMEOUT_MS = 20_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MCP 서버 연결 타임아웃(${TIMEOUT_MS / 1000}초)`)), TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    const { tools } = await client.listTools();
    const tags = new Set<string>();
    const displayNames = new Map<string, string>();
    for (const t of tools) {
      tags.add(t.name);
      displayNames.set(t.name, t.name);
    }
    return { tags, displayNames };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

// CLI에만 있고 MCP엔 의도적으로 없는 이름(정확한 근거는
// .claude/skills/claude-native-workflow/SKILL.md의 "CLI/MCP에
// 의도적으로 없는 기능" 절 - 이 목록을 바꾸면 그 문서도 같이 확인).
// 코멘트/폴더는 CLI·MCP 양쪽 다 아예 없는 기능이라 여기 넣을 필요가
// 없다(애초에 tags 집합 어느 쪽에도 안 잡힘).
const KNOWN_CLI_ONLY = new Set([
  "auth_register",
  "auth_login",
  "auth_logout",
  "auth_change_password", // 본인 비밀번호 변경 - auth login/register와 같은 급의 신원 관리 동작(비밀번호가 대화 컨텍스트에 남으면 안 됨)
  "auth_use_key", // 로컬 자격증명 파일 저장 - 서버 호출 자체가 없음
  "key_create",
  "key_list",
  "key_revoke",
  "git_my_token", // Gitea PAT 재발급 - key_create와 같은 급의 1회 노출 비밀 발급
  "user_list", // admin 전용 전체 사용자 목록 - 신원 관리 동작
  "user_reset_password", // admin 대행 비밀번호 재설정 - key_create와 같은 급의 1회 노출 비밀 발급
  "user_access_overview", // admin이 임의의 특정 사용자를 지목해 그의 접근 제한을 조회 - user 그룹의 나머지 두 항목과 같은 급의 신원 관리 동작(본인 조회용 access_overview는 MCP에 그대로 있음)
]);

// CLI는 명령 자체가 이미 특정 리소스 전용 화면/맥락 안에 있어(예: 이
// CLI 하나가 곧 "문서 워크플로우 도구") 짧은 동사만 써도 되지만, MCP는
// 도구 108개가 평평한 한 목록으로 LLM에 노출되므로 어느 리소스에 대한
// 동작인지 이름에서 바로 알 수 있게 리소스 접두어를 붙인다 - 그래서
// 실제로는 1:1로 대응하지만 문자열이 다른 경우가 있다. 새로 CLI
// 명령을 추가하는데 MCP 쪽에서 리소스 접두어를 붙이기로 했다면 이
// 목록에도 추가한다(키: CLI 태그, 값: MCP 태그).
const KNOWN_RENAMES: Record<string, string> = {
  teams: "team_list",
  team_admins: "team_admin_list",
  groups: "group_list",
  group_admins: "group_admin_list",
  projects: "project_list",
  project: "project_get",
  members: "member_list",
  doctypes: "doctype_list",
  new: "document_new",
  get: "document_get",
  list: "document_list",
  search: "document_search",
  save: "document_save",
  transition: "document_transition",
  transition_bulk: "document_transition_bulk",
  priority_set: "document_priority_set",
  link: "document_link",
  backlinks: "document_backlinks",
  revisions: "document_revisions",
  read: "document_read",
  grep: "document_grep",
  diff: "document_diff",
  delete: "document_delete",
  next_statuses: "document_next_statuses",
  link_source: "document_link_source",
  unlink_source: "document_unlink_source",
  source_links: "document_source_links",
  link_branch: "document_link_branch",
  unlink_branch: "document_unlink_branch",
  branch_links: "document_branch_links",
  question: "question_add",
  question_source: "question_add_source",
  questions: "question_list",
  questions_source: "question_list_source",
  pending: "pending_list",
  reply: "question_reply",
  hook_queue: "hook_queue_list",
};

async function main() {
  const cli = extractCliCommands();
  const mcp = await fetchMcpToolTags();

  const renamedMcpTags = new Set(Object.values(KNOWN_RENAMES));
  const cliOnly = [...cli.tags].filter(
    (t) => !KNOWN_CLI_ONLY.has(t) && !mcp.tags.has(t) && !mcp.tags.has(KNOWN_RENAMES[t]),
  );
  const mcpOnly = [...mcp.tags].filter((t) => !cli.tags.has(t) && !renamedMcpTags.has(t));
  const appliedExceptions = [...KNOWN_CLI_ONLY].filter((t) => cli.tags.has(t));
  const unusedExceptions = [...KNOWN_CLI_ONLY].filter((t) => !cli.tags.has(t));
  const staleRenames = Object.entries(KNOWN_RENAMES).filter(
    ([cliTag, mcpTag]) => !cli.tags.has(cliTag) || !mcp.tags.has(mcpTag),
  );

  console.log(`CLI 리프 명령: ${cli.tags.size}개`);
  console.log(`MCP 도구: ${mcp.tags.size}개`);
  console.log(`허용된 의도적 예외(CLI 전용): ${appliedExceptions.length}개 - ${appliedExceptions.join(", ")}`);
  if (unusedExceptions.length > 0) {
    console.log(
      `⚠ 허용목록에 있지만 CLI에서 실제로 발견되지 않은 이름(이름이 바뀌었거나 삭제됐을 수 있음 - 스크립트의 KNOWN_CLI_ONLY 갱신 필요): ${unusedExceptions.join(", ")}`,
    );
  }

  let ok = true;
  if (cliOnly.length > 0) {
    ok = false;
    console.log(`\n❌ CLI에는 있는데 MCP엔 없는 명령(${cliOnly.length}개, 의도적 예외 아님):`);
    for (const tag of cliOnly) console.log(`  - ${cli.displayNames.get(tag) ?? tag}`);
  }
  if (mcpOnly.length > 0) {
    ok = false;
    console.log(`\n❌ MCP에는 있는데 CLI엔 없는 도구(${mcpOnly.length}개):`);
    for (const tag of mcpOnly) console.log(`  - ${mcp.displayNames.get(tag) ?? tag}`);
  }

  if (ok) {
    console.log("\n✅ CLI/MCP 대칭성 이상 없음(의도적 예외 제외 전부 일치).");
  } else {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
