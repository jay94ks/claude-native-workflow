// 배치 1(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - CLI
// 전체가 공유하는 6개 헬퍼(printJson/parseChoices/run/splitCsv/
// parseDataOption/sleep)를 cli/index.ts에서 그대로 잘라낸 것 - 로직은
// 전혀 안 바뀜.
import type { Command } from "commander";
import type { z } from "zod";
import { apiCall, apiCallValidated, formatNotices } from "./apiclient.js";
import { buildListUrl, paramOptsKey, type ListOperationSpec } from "../shared/listOperation.js";

// AI 안내(prologue) - 응답에 notices 배열이 있으면 JSON을 찍기 전에
// 각 줄을 먼저 출력한다(필드 자체는 JSON에도 그대로 남김 - 사람이 읽는
// 출력과 파싱하는 코드 양쪽 다 신호를 받게).
export function printJson(value: unknown): void {
  for (const line of formatNotices(value)) console.log(line);
  console.log(JSON.stringify(value, null, 2));
}

// "--choices" 플래그 파싱 - 선택지끼리는 ";;", 한 선택지 안 라벨/
// 부가정보는 ":::"로 구분한다(--refs의 쉼표 구분 관례를 참고 -
// 라벨/부가정보 텍스트 안에 쉼표가 흔히 들어갈 수 있어 더 드문
// 구분자를 쓴다).
export function parseChoices(raw?: string): { label: string; detail?: string }[] | undefined {
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

export async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

export function splitCsv(raw?: string): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseDataOption(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("--data는 올바른 JSON이어야 합니다");
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BL-57F8DF17 #64(PN-01007911) - "연산 서술자" 하나로 목록/필터 계열
// CLI 명령을 생성한다(대응하는 MCP 쪽은 mcp/shared.ts의
// registerListTool). `<parent>.command("<cliName> <projectId>")`를
// 만들고 spec.filters에서 Commander 옵션을 그대로 유도한다.
// responseSchema를 주면(#66 apiCallValidated 시범 적용 대상처럼) 응답을
// 그 zod 스키마로 검증한다 - 생략하면 기존 관례대로 무검증 apiCall.
export function registerListCommand(
  parent: Command,
  spec: ListOperationSpec,
  responseSchema?: z.ZodTypeAny,
): void {
  const cmd = parent.command(`${spec.cliName} <projectId>`);
  if (spec.cliDescription) cmd.description(spec.cliDescription);
  for (const f of spec.filters ?? []) {
    cmd.option(f.cliFlag, f.description);
  }
  if (spec.paginated !== false) {
    cmd.option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열");
    cmd.option("--count <n>", "페이지당 개수(--page와 함께)");
  }
  cmd.action((projectId, opts) =>
    run(async () => {
      const args: Record<string, unknown> = { projectId };
      for (const f of spec.filters ?? []) args[f.key] = opts[paramOptsKey(f)];
      if (spec.paginated !== false) {
        args.page = opts.page;
        args.pageSize = opts.count;
      }
      const url = buildListUrl(spec, projectId, args);
      printJson(responseSchema ? await apiCallValidated(url, responseSchema) : await apiCall(url));
    }),
  );
}
