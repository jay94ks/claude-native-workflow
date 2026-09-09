#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { setProjectRoot } from "../core/paths.js";
import { buildTree, listPending, listByTypes, getDoc, extractSection } from "../core/docstore.js";
import { answerPending } from "../core/reply.js";
import { createDoc } from "../core/create.js";
import { transitionDone } from "../core/transition.js";
import { DESIGN_TYPES, TYPE_NAMES } from "../core/types.js";

// SP-00001 3절의 MCP 도구. api/server.ts, cli/index.ts와 마찬가지로 core/를
// 직접 호출한다(1절: "MCP 서버, CLI, 로컬 API가 전부 같은 core/ 함수를
// 직접 호출한다") - 서로를 거쳐가지 않음. git_sync/git_log/docs_comment는
// core에 그 모듈이 아직 없어(PL-00001 2단계 5~6번) 이번엔 등록하지 않는다.

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

function main() {
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
        return textResult(createDoc({ type, title, links }));
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
        return textResult(answerPending(path, question_id, answer));
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
        return textResult(transitionDone(plan_id, report));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

main();
