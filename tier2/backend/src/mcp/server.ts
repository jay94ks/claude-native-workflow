#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { setProjectRoot } from "../core/paths.js";
import { buildTree, listPending, listByTypes, getDoc, extractSection, saveDocBody, searchDocs } from "../core/docstore.js";
import { answerPending } from "../core/reply.js";
import { createDoc } from "../core/create.js";
import { transitionDone } from "../core/transition.js";
import { DESIGN_TYPES, TYPE_NAMES } from "../core/types.js";
import { pull as gitPull, sync as gitSync } from "../core/git.js";
import { gitLog, gitCommitDetail, gitDiff, gitBlame } from "../core/gitlog.js";
import { listComments, addComment, resolveComment } from "../core/comments.js";
import { listChangeNotices, ackChangeNotice } from "../core/changes.js";

// SP-00001 3절의 MCP 도구. api/server.ts, cli/index.ts와 마찬가지로 core/를
// 직접 호출한다(1절: "MCP 서버, CLI, 로컬 API가 전부 같은 core/ 함수를
// 직접 호출한다") - 서로를 거쳐가지 않음.

function parseRootArg(argv: string[]): string {
  const idx = argv.indexOf("--root");
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : process.cwd();
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function main() {
  setProjectRoot(parseRootArg(process.argv.slice(2)));

  const server = new McpServer({ name: "claude-native-workflow-docs", version: "0.1.0" });

  server.registerTool(
    "docs_tree",
    { title: "문서 트리 조회", description: "docs/ 전체 트리 구조를 반환한다.", inputSchema: {} },
    async () => textResult(buildTree()),
  );

  server.registerTool(
    "docs_get",
    {
      title: "문서 1건 조회",
      description: "docs/ 기준 상대 경로로 문서를 조회한다. anchor를 주면 해당 섹션만 반환한다.",
      inputSchema: { path: z.string(), anchor: z.string().optional() },
    },
    async ({ path, anchor }) => {
      const doc = getDoc(path);
      if (!doc) return errorResult(new Error(`찾을 수 없습니다: ${path}`));
      if (anchor) {
        const section = extractSection(doc.body, anchor);
        if (section === null) return errorResult(new Error(`앵커를 찾을 수 없습니다: ${anchor}`));
        return textResult({ path: doc.path, meta: doc.meta, body: section, anchor });
      }
      return textResult(doc);
    },
  );

  server.registerTool(
    "docs_pending",
    { title: "답변 대기 목록", description: "미답변 (Qn) 질문 목록을 반환한다.", inputSchema: {} },
    async () => textResult(listPending()),
  );

  server.registerTool(
    "docs_list",
    {
      title: "타입별 문서 목록",
      description: "design(DC/RV/FX) · logs(LG) · all(전체) 중 하나를 조회한다.",
      inputSchema: { kind: z.enum(["design", "logs", "all"]) },
    },
    async ({ kind }) => {
      if (kind === "design") return textResult(listByTypes(DESIGN_TYPES));
      if (kind === "logs") return textResult(listByTypes(new Set(["LG"])));
      return textResult(listByTypes(new Set(Object.keys(TYPE_NAMES).filter((t) => t !== "IX"))));
    },
  );

  server.registerTool(
    "docs_search",
    {
      title: "전문 검색",
      description: "제목/본문에서 검색어를 포함하는 문서를 찾는다.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => textResult(searchDocs(query)),
  );

  server.registerTool(
    "docs_save",
    {
      title: "문서 본문 갱신",
      description:
        "기존 문서의 본문 전체를 새 내용으로 덮어쓴다(git 자동 커밋 없음 - " +
        "필요하면 git_sync를 이어서 호출). 덮어쓰기 전에 docs_get으로 현재 " +
        "내용을 먼저 확인할 것.",
      inputSchema: { path: z.string(), body: z.string() },
    },
    async ({ path, body }) => {
      try {
        return textResult(saveDocBody(path, body));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "docs_new",
    {
      title: "새 문서 생성",
      description: "지정한 타입의 새 문서를 생성하고 색인에 등재한다.",
      inputSchema: {
        type: z.string(), title: z.string(), links: z.array(z.string()).optional(),
      },
    },
    async ({ type, title, links }) => {
      try {
        return textResult(await createDoc({ type, title, links }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "docs_reply",
    {
      title: "답변 대기 질문에 답변",
      description: "DC/RV/FX 문서의 (Qn) 질문에 답변을 기록한다(RP는 대상 문서 안에 폴딩).",
      inputSchema: { path: z.string(), question_id: z.string(), answer: z.string() },
    },
    async ({ path, question_id, answer }) => {
      try {
        return textResult(await answerPending(path, question_id, answer));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "docs_transition_done",
    {
      title: "PL -> DN 전환",
      description: "완료된 계획(PL)을 결과 보고(DN)로 전환하고 원본은 스텁으로 남긴다.",
      inputSchema: { plan_id: z.string(), report: z.string() },
    },
    async ({ plan_id, report }) => {
      try {
        return textResult(await transitionDone(plan_id, report));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "git_sync",
    {
      title: "git pull -> commit -> push",
      description: "docs/ 변경분을 pull -> commit -> push로 한 번에 동기화한다.",
      inputSchema: { message: z.string().optional() },
    },
    async ({ message }) => {
      try {
        return textResult(await gitSync(message));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "git_log",
    {
      title: "git 이력/diff/blame 조회(읽기 전용)",
      description:
        "action=log(커밋 목록, path/limit 옵션) · show(sha로 커밋 1건 상세) · " +
        "diff(sha로 변경 내용) · blame(path로 줄별 이력) 중 하나를 실행한다.",
      inputSchema: {
        action: z.enum(["log", "show", "diff", "blame"]),
        path: z.string().optional(),
        sha: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ action, path, sha, limit }) => {
      try {
        if (action === "log") return textResult(await gitLog(path, limit ?? 30));
        if (action === "show") {
          if (!sha) return errorResult(new Error("show는 sha가 필요합니다"));
          const detail = await gitCommitDetail(sha);
          if (!detail) return errorResult(new Error(`찾을 수 없습니다: ${sha}`));
          return textResult(detail);
        }
        if (action === "diff") {
          if (!sha) return errorResult(new Error("diff는 sha가 필요합니다"));
          return textResult({ diff: await gitDiff(sha) });
        }
        if (!path) return errorResult(new Error("blame은 path가 필요합니다"));
        return textResult({ blame: await gitBlame(path) });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "docs_comment",
    {
      title: "문서 코멘트(비공식 토론용)",
      description:
        "SP-00003 2절 - docs/PROTOCOL.md의 공식 답변 대기(RP)와 별개인 문서 단위 " +
        "코멘트. action=list(조회) · add(작성, text 필요) · resolve(해결 처리, comment_id 필요).",
      inputSchema: {
        action: z.enum(["list", "add", "resolve"]),
        path: z.string(),
        text: z.string().optional(),
        comment_id: z.number().optional(),
      },
    },
    async ({ action, path, text, comment_id }) => {
      try {
        if (action === "list") return textResult(await listComments(path));
        if (action === "add") {
          if (!text) return errorResult(new Error("add는 text가 필요합니다"));
          return textResult({ id: await addComment(path, text) });
        }
        if (comment_id === undefined) return errorResult(new Error("resolve는 comment_id가 필요합니다"));
        await resolveComment(path, comment_id);
        return textResult({ ok: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "docs_changes",
    {
      title: "변경 추적 큐 조회/확인(SP-00003 5절)",
      description:
        "SP-00001 3절 표엔 없지만, 5절이 설명하는 '설계자가 없는 사이 뭐가 바뀌었는지' " +
        "확인 흐름의 실제 소비자가 Claude라서 추가한 도구. action=list(미확인 변경 " +
        "목록) · ack(id로 확인 처리, 큐에서 제거).",
      inputSchema: { action: z.enum(["list", "ack"]), id: z.number().optional() },
    },
    async ({ action, id }) => {
      if (action === "list") return textResult(listChangeNotices());
      if (id === undefined) return errorResult(new Error("ack는 id가 필요합니다"));
      ackChangeNotice(id);
      return textResult({ ok: true });
    },
  );

  // SP-00001 5절: "세션/백엔드 기동 시" git pull - MCP 서버가 뜨는 시점도
  // 이 "세션 시작"에 해당한다. 충돌은 보고만 하고 서버는 계속 뜬다.
  const pullResult = await gitPull();
  if (pullResult.attempted && !pullResult.ok) {
    console.error(`git pull 실패(설계자 확인 필요): ${pullResult.message}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
