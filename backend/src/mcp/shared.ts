// 배치 1(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - MCP
// 서버 전체가 공유하는 결과 포맷 헬퍼(textResult/errorResult)를
// mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, formatNotices } from "../cli/apiclient.js";
import { buildListUrl, type ListOperationSpec } from "../shared/listOperation.js";

// AI 안내(prologue) - 응답 객체에 notices: string[]가 있으면 JSON
// 블록 앞에 별도 text content 블록을 하나 더 붙인다(MCP가 다중 content
// 블록을 지원 - "prologue"라는 표현 그대로 본문 앞에 별개 블록).
export function textResult(value: unknown) {
  const blocks: { type: "text"; text: string }[] = formatNotices(value).map((text) => ({ type: "text", text }));
  blocks.push({ type: "text", text: JSON.stringify(value, null, 2) });
  return { content: blocks };
}

export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export async function call<T>(pathSuffix: string, init?: RequestInit): Promise<T> {
  return apiCall<T>(pathSuffix, init);
}

// git_put/git_add/git_add_bulk가 content를 그대로 받으면, 밀도 높은
// 한글처럼 모델이 토큰 단위로 다시 "타이핑"해야 하는 텍스트에서 드물게
// 음절이 유사한 다른 음절로 치환되는 게 실측 확인됐다(PN-46EE061F -
// minicore 프로젝트에서 git_add_bulk로 7회 넘게 재현, CLI의 `docs git
// add-bulk`(로컬 파일을 fs.readFileSync로 직접 읽어 보냄, 모델이 내용을
// 생성할 필요가 없음)로는 즉시 깨끗했음). localFile을 주면 이 MCP
// 서버가 CLI와 똑같은 방식으로 디스크에서 직접 읽어, 모델이 파일
// 내용을 거치지 않게 한다 - content/localFile 중 정확히 하나만 허용.
export function resolveFileContent(content: unknown, localFile: unknown): string {
  const hasContent = typeof content === "string";
  const hasLocalFile = typeof localFile === "string";
  if (hasContent === hasLocalFile) {
    throw new Error("content와 localFile 중 정확히 하나만 지정해야 합니다");
  }
  if (hasLocalFile) {
    // git put/add CLI와 같은 이유로 CRLF→LF 정규화(#git-path-separator와
    // 같은 취지 - Windows에서 읽은 파일을 실제 git commit과 동일하게).
    return fs.readFileSync(localFile as string, "utf-8").replace(/\r\n/g, "\n");
  }
  return content as string;
}

/** 원래 main() 안 로컬 함수였던 `tool()` 등록 헬퍼를 그대로 팩토리로
 * 뺐다 - 도메인별 파일(mcp/tools/<domain>.ts)이 이 반환값을 받아
 * 자기 도구들을 등록한다(server 인스턴스 자체를 도메인 파일에 넘기지
 * 않음 - server.registerTool 직접 호출/try-catch+textResult/errorResult
 * 래핑 로직은 여기 한 곳에만 있게). 로직은 원래 main() 안의 tool()과
 * 전혀 안 바뀜. */
export type ToolRegistrar = (
  name: string,
  title: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
) => void;

export function createToolRegistrar(server: McpServer): ToolRegistrar {
  return (name, title, description, inputSchema, handler) => {
    server.registerTool(name, { title, description, inputSchema }, async (args) => {
      try {
        return textResult(await handler(args ?? {}));
      } catch (err) {
        return errorResult(err);
      }
    });
  };
}

// BL-57F8DF17 #64(PN-01007911) - "연산 서술자" 하나로 목록/필터 계열
// MCP 도구를 생성한다(대응하는 CLI 쪽은 cli/shared.ts의
// registerListCommand). spec.filters의 type("string"/"boolean")에서
// zod 파라미터 스키마를 그대로 유도한다.
export function registerListTool(tool: ToolRegistrar, spec: ListOperationSpec): void {
  const inputSchema: Record<string, z.ZodTypeAny> = { projectId: z.string() };
  for (const f of spec.filters ?? []) {
    inputSchema[f.key] = (f.type === "boolean" ? z.boolean() : z.string()).optional();
  }
  if (spec.paginated !== false) {
    inputSchema.page = z.number().optional();
    inputSchema.pageSize = z.number().optional();
  }
  tool(spec.mcpName, spec.mcpTitle, spec.mcpDescription, inputSchema, async (a) =>
    call(buildListUrl(spec, String(a.projectId), a)),
  );
}
