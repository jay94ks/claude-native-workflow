#!/usr/bin/env node
import { Command } from "commander";
import {
  ApiClient,
  findProjectRoot,
  readProjectConfig,
  writeProjectConfig,
  writeSessionConfig,
  setDesignerCredentials,
  resolveClientConfig,
  detectLocalGit,
  readStaging,
  appendStaging,
  clearStaging,
  readCache,
  writeCacheEntry,
} from "@cnw/shared";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8388";

const program = new Command();
program.name("docs").description("claude-native-workflow v3 CLI");

const auth = program.command("auth");

auth
  .command("login")
  .description("log in and record credentials in the home config")
  .requiredOption("--username <username>")
  .requiredOption("--password <password>")
  .option("--rest-url <url>", "server to log into (defaults to the linked project's, or the built-in default)")
  .option("--project <projectId>", "project id (slug) to link this directory to, if not already linked")
  .option("--owner <username>", "username of that project's creator - defaults to --username (i.e. your own project) if omitted")
  .action(async (opts) => {
    const cwd = process.cwd();
    const existingRoot = findProjectRoot(cwd);
    const existing = existingRoot ? readProjectConfig(cwd).config : null;

    const httpEndpoint = opts.restUrl ?? existing?.httpEndpoint ?? DEFAULT_ENDPOINT;
    const projectId = opts.project ?? existing?.projectId;
    // 설계자 요청(2026-09-21 후속) - project id는 이제 그 생성자(owner)
    // 범위에서만 유일해서, projectId만으로는 어느 프로젝트인지 특정할 수
    // 없다 - --owner가 없으면 "자신의 프로젝트를 링크하는 것"이라는 가장
    // 흔한 경우로 기본값을 잡는다(틀렸으면 첫 액션 호출에서 바로 "프로젝트를
    // 찾을 수 없습니다"로 드러난다 - 조용히 잘못된 프로젝트에 연결되진 않는다).
    const owner = opts.owner ?? existing?.owner ?? opts.username;
    if (!projectId) {
      console.error('no project linked here yet - pass --project <projectId> (or "docs" scaffold seeds a demo project id you can use).');
      process.exitCode = 1;
      return;
    }

    const client = new ApiClient(httpEndpoint);
    const { architectId, apiKey } = await client.login(opts.username, opts.password);

    const root = existingRoot ?? cwd;
    writeProjectConfig(root, { httpEndpoint, owner, projectId });
    writeSessionConfig(root, { architectId });
    setDesignerCredentials(httpEndpoint, owner, projectId, architectId, { endpoint: httpEndpoint, apiKey });

    console.log(`logged in as ${opts.username} (architectId ${architectId}) for project ${owner}/${projectId} @ ${httpEndpoint}`);
  });

/** action 이름 하나당 서브커맨드 하나 - 전부 같은 apiclient.run()으로 위임하는 얇은 래퍼. */
function registerActionCommands(namespace: string, verbs: string[]) {
  const group = namespace === "docs" ? program : program.command(namespace);
  for (const verb of verbs) {
    const cmd = group
      .command(verb)
      .description(`${namespace}.${verb} (bulk action, this scaffold sends one item)`)
      .argument("[json]", "action payload as a JSON string (without the \"action\"/\"projectId\" fields)")
      .option("--stage", "network으로 바로 보내지 않고 .cnw/staging.json에 쌓아둔다 - 나중에 \"docs push\"로 한 번에 전송");

    if (namespace === "docs" && verb === "search") {
      cmd
        .option("--codes-only", "본문 없이 추적 코드만 출력 (CLAUDE.md 규칙 6 - 응답 비대화 방지)")
        .option("--lines <n>", "각 결과의 본문을 앞 n줄까지만 출력", (v) => parseInt(v, 10));
    }

    cmd.action(async (json: string | undefined, opts: { stage?: boolean; codesOnly?: boolean; lines?: number }) => {
      const { root, config } = readProjectConfig();
      const payload = json ? JSON.parse(json) : {};

      // design-notes.md "git 연동": CLI는 로컬 git의 현재 branch/commit_id를
      // 자동으로 인식해 채운다(명시적으로 넘긴 값이 있으면 그게 우선).
      if (namespace === "docs" && verb === "add") {
        const local = detectLocalGit();
        if (local) {
          payload.branch ??= local.branch;
          payload.commitId ??= local.commitId;
        }
      }

      // 설계자 요청(2026-09-21 후속) - project id는 이제 그 생성자(owner)
      // 범위에서만 유일하므로 owner도 항상 같이 보낸다 - project.create/
      // list처럼 이 값이 필요 없는 액션은 서버가 그냥 무시한다(핸들러가
      // payload.projectId를 안 읽으므로 무해함).
      const action = { action: `${namespace}.${verb}`, owner: config.owner, projectId: config.projectId, ...payload };

      // Phase 8 "로컬 스테이징": 바로 보내는 대신 파일에 쌓아두고 "docs push"에서 한 번에 전송.
      if (opts.stage) {
        appendStaging(root, action);
        console.log(`staged ${action.action} (.cnw/staging.json) - run "docs push" to send.`);
        return;
      }

      const clientConfig = resolveClientConfig();
      const client = new ApiClient(clientConfig.endpoint, clientConfig.apiKey);
      const envelope = await client.run([action]);
      // notices는 메시지 시스템의 piggyback 배선(design-notes.md "메시지 시스템") -
      // 예외 없이 모든 응답에 실리므로 여기서도 항상 같이 보여준다.
      if (envelope.notices.length > 0) {
        console.log(`notices: ${JSON.stringify(envelope.notices)}`);
      }
      const result = envelope.result[0];

      // Phase 8 "로컬 캐시": docs.get이 받아온 본문은 .cnw/cache.json에 남겨서
      // "docs cat"이 재요청 없이 곧장 읽을 수 있게 한다 - 정본은 여전히 서버.
      if (namespace === "docs" && verb === "get" && result.ok && result.data) {
        const doc = result.data as { code: string };
        writeCacheEntry(root, doc.code, doc);
      }

      if (namespace === "docs" && verb === "search" && result.ok && result.data) {
        const data = result.data as { items: Array<Record<string, unknown>> };
        const items = data.items.map((item) => {
          if (opts.codesOnly) {
            const { code, title, type, kind, state } = item as any;
            return { code, title, type, kind, state };
          }
          if (typeof opts.lines === "number" && typeof item.content === "string") {
            return { ...item, content: item.content.split("\n").slice(0, opts.lines).join("\n") };
          }
          return item;
        });
        console.log(JSON.stringify({ ...result, data: { ...data, items } }, null, 2));
        return;
      }

      console.log(JSON.stringify(result, null, 2));
    });
  }
}

registerActionCommands("docs", ["status", "list", "search", "get", "add", "update", "delete", "transition", "tag", "grep"]);
registerActionCommands("remember", ["add", "update", "delete", "list"]);
registerActionCommands("message", ["send", "list", "transition"]);
registerActionCommands("repo", ["push", "connectGitea", "branches", "tree", "file", "commits", "writeFile"]);
registerActionCommands("project", ["create", "get", "list", "update", "invite", "acceptInvite", "transfer", "transferOwnership", "destroy", "members", "invitesForMe"]);
registerActionCommands("template", ["set", "get", "delete", "deploy"]);
registerActionCommands("webhook", ["add", "list", "delete"]);
registerActionCommands("pr", ["create", "list", "get", "update", "merge", "close"]);
registerActionCommands("account", ["list", "me", "changePassword", "updateNickname", "resetPassword", "disable", "enable", "delete"]);
registerActionCommands("apiKey", ["create", "list", "listForProject", "revoke"]);

// Phase 8 "로컬 스테이징": 쌓인 액션을 한 번에 bulk 전송.
program
  .command("push")
  .description("docs push - .cnw/staging.json에 --stage로 쌓인 액션을 한 번에 서버로 전송하고 비운다")
  .action(async () => {
    const { root } = readProjectConfig();
    const staged = readStaging(root);
    if (staged.length === 0) {
      console.log("staged actions 없음 (.cnw/staging.json이 비어있음).");
      return;
    }
    const clientConfig = resolveClientConfig();
    const client = new ApiClient(clientConfig.endpoint, clientConfig.apiKey);
    const envelope = await client.run(staged as any);
    clearStaging(root);
    if (envelope.notices.length > 0) {
      console.log(`notices: ${JSON.stringify(envelope.notices)}`);
    }
    console.log(`pushed ${staged.length} action(s):`);
    console.log(JSON.stringify(envelope.result, null, 2));
  });

const stage = program.command("stage").description("로컬 스테이징 파일(.cnw/staging.json) 관리");

stage
  .command("list")
  .description("아직 push하지 않은 staged 액션 목록")
  .action(() => {
    const { root } = readProjectConfig();
    console.log(JSON.stringify(readStaging(root), null, 2));
  });

stage
  .command("clear")
  .description("push하지 않고 staged 액션을 전부 버린다")
  .action(() => {
    const { root } = readProjectConfig();
    clearStaging(root);
    console.log("staging 비움.");
  });

// Phase 8 "로컬 캐시": 마지막으로 "docs get"한 본문을 재요청 없이 읽는다.
program
  .command("cat <code>")
  .description("docs get으로 캐시된(.cnw/cache.json) 문서 본문을 네트워크 없이 출력한다")
  .action((code: string) => {
    const { root } = readProjectConfig();
    const cache = readCache(root);
    const entry = cache[code];
    if (!entry) {
      console.error(`캐시에 ${code}가 없습니다 - 먼저 "docs get ${code}"로 조회하세요.`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(entry, null, 2));
  });

program.parseAsync(process.argv);
