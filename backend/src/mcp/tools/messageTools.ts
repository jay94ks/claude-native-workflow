// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 인스턴스
// 메시징(대기/처리중/기록 상태 구분). mcp/server.ts에서 그대로 잘라낸 것
// - 로직은 전혀 안 바뀜. 원래 물리적으로 "git push 훅" 섹션 바로 뒤에
// 헤더 없이 이어져 있었다 - 별도 도메인이라 갈라냄.
import { z } from "zod";
import { waitForMessageDirect } from "../../cli/apiclient.js";
import { call, type ToolRegistrar } from "../shared.js";

export function registerMessageTools(tool: ToolRegistrar): void {
  tool(
    "message_list",
    "인스턴스 메시지 목록",
    "그 프로젝트의 메시지 기록을 조회한다 - 조회 자체는 상태(대기/처리중/기록)를 안 바꾼다(읽음은 message_ack와 별개 축). status로 pending(대기)/processing(처리중)/delivered(기록)/active(대기+처리중, 기록 제외)/all 필터 가능 - 생략하면 기본 active(아직 처리 안 끝난 것만, 이미 완료된 기록은 안 보냄 - 전체 이력이 필요하면 all을 명시). origin으로 designer(웹에서 옴)/ai(CLI/MCP에서 옴) 필터도 가능(#message-origin-tagging) - 생략하면 방향 구분 없이 전체. page/pageSize를 주면 페이지네이션 응답(total 포함)을 받는다 - 단, 이 경우 웹 화면과 공유하는 라우트라 deliveredAt 자동 갱신은 안 됨. 생략하면 기존처럼 전체 배열 + deliveredAt 자동 갱신.",
    {
      projectId: z.string(),
      status: z.enum(["pending", "processing", "delivered", "active", "all"]).optional(),
      origin: z.enum(["designer", "ai"]).optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async (a) => {
      const status = a.status ?? "active";
      const paged = a.page !== undefined || a.pageSize !== undefined;
      if (paged) {
        const qs = new URLSearchParams({ status: String(status), page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20), ...(a.origin ? { origin: String(a.origin) } : {}) });
        return call(`/api/projects/${a.projectId}/messages/page?${qs}`);
      }
      const qs = new URLSearchParams({ markDelivered: "true", status: String(status), ...(a.origin ? { origin: String(a.origin) } : {}) });
      return call(`/api/projects/${a.projectId}/messages?${qs}`);
    },
  );
  tool(
    "message_send",
    "인스턴스 메시지 전송",
    "같은 프로젝트의 다른 세션/설계자에게 메시지를 남긴다. 이 도구로 보낸 메시지는 origin이 자동으로 ai로 기록된다(#message-origin-tagging - MCP는 항상 X-Client-Kind: cli를 붙이는 공유 클라이언트를 거치므로, 이 도구를 부르는 것 자체가 이미 AI가 설계자에게 보내는 것으로 분류됨).",
    { projectId: z.string(), body: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/messages`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "message_wait",
    "새 메시지 대기",
    "새 메시지가 오거나 timeoutSec(전체 대기 시간)이 다 될 때까지 기다린다 - EMQX에 직접 구독해 대기하므로(서버는 블로킹하지 않음) 메시지가 오면 즉시 잡히고, 이 경로를 못 쓰는 환경에서는 10초 단위 HTTP 폴링으로 자동 폴백한다. 받은 메시지는 자동으로 기록(delivered) 처리된다.",
    { projectId: z.string(), timeoutSec: z.number().optional() },
    async (a) => waitForMessageDirect(a.projectId as string, (a.timeoutSec as number | undefined) ?? 60),
  );
  tool(
    "message_recent",
    "최근 메시지 조회(장애 복구용)",
    "상태를 전혀 바꾸지 않는 순수 조회 - 시스템 다운 등으로 세션이 비정상 종료됐다가 복구됐을 때 마지막 기록을 확인하는 용도라 반복 호출해도 안전하다. 대기/기록 구분 없이 최신순.",
    { projectId: z.string(), limit: z.number().optional() },
    async (a) => {
      const qs = a.limit ? `?limit=${encodeURIComponent(String(a.limit))}` : "";
      return call(`/api/projects/${a.projectId}/messages/recent${qs}`);
    },
  );
  tool(
    "message_edit",
    "메시지 수정",
    "본인이 보낸 메시지만 수정할 수 있다.",
    { id: z.string(), body: z.string() },
    async (a) => call(`/api/messages/${a.id}`, { method: "PUT", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "message_delete",
    "메시지 삭제",
    "본인이 보낸 메시지만 삭제할 수 있다.",
    { id: z.string() },
    async (a) => call(`/api/messages/${a.id}`, { method: "DELETE" }),
  );
  tool(
    "message_ack",
    "메시지 처리 시작 표시",
    "대기 → 처리중으로 옮긴다(프로젝트 멤버 누구나 가능 - 보낸 사람이 아니어도 됨). 이미 처리중이거나 기록 상태면 그대로 반환.",
    { id: z.string() },
    async (a) => call(`/api/messages/${a.id}/ack`, { method: "PUT" }),
  );
  tool(
    "message_complete",
    "메시지 처리 완료 표시",
    "처리중 → 기록으로 옮긴다. ack 없이 바로 불러도 ackedAt까지 자동으로 채워진다. 이미 기록 상태면 그대로 반환.",
    { id: z.string() },
    async (a) => call(`/api/messages/${a.id}/complete`, { method: "PUT" }),
  );
}
