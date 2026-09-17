// 배치 2i(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 칸반
// 보드. mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// 코멘트/폴더와 달리 이 기능은 AI에게 완전히 노출된다 - 컬럼 순서/숨김
// 변경과 카드 코멘트만 예외(개인 UI 설정이거나 설계자간 채널)로 없음.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerKanbanTools(tool: ToolRegistrar): void {
  tool(
    "kanban_columns",
    "칸반 분류 목록",
    "이 프로젝트의 칸반 분류(컬럼) 목록 - 순서/숨김은 이 신원 기준. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/projects/${a.projectId}/kanban/columns`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/projects/${a.projectId}/kanban/columns/page?${qs}`);
    },
  );
  tool(
    "kanban_card_new",
    "칸반 카드 생성",
    "칸반 카드를 만들어 분류에 추가한다(AI가 만든 카드로 기록됨 - 설계자가 만든 카드와 달리 메시지 알림이 안 감).",
    {
      projectId: z.string(),
      columnId: z.string(),
      title: z.string(),
      body: z.string().optional(),
      refs: z.array(z.string()).optional(),
    },
    async (a) =>
      call(`/api/projects/${a.projectId}/kanban/cards`, {
        method: "POST",
        body: JSON.stringify({ columnId: a.columnId, title: a.title, body: a.body, refs: a.refs, origin: "ai" }),
      }),
  );
  tool(
    "kanban_cards",
    "칸반 카드 목록",
    "칸반 카드 목록(숨긴 카드 제외) - columnId를 주면 그 분류로 제한. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), columnId: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        ...(a.columnId ? { columnId: String(a.columnId) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/projects/${a.projectId}/kanban/cards${suffix}${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool(
    "kanban_card_get",
    "칸반 카드 상세",
    "칸반 카드 상세(근거 문서 포함).",
    { trackingCode: z.string() },
    async (a) => call(`/api/kanban/cards/${a.trackingCode}`),
  );
  tool(
    "kanban_card_move",
    "칸반 카드 이동",
    "칸반 카드를 다른 분류로(또는 같은 분류 안 다른 위치로) 옮긴다.",
    { trackingCode: z.string(), toColumnId: z.string(), toIndex: z.number().optional() },
    async (a) =>
      call(`/api/kanban/cards/${a.trackingCode}/move`, {
        method: "PUT",
        body: JSON.stringify({ toColumnId: a.toColumnId, toIndex: a.toIndex }),
      }),
  );
}
