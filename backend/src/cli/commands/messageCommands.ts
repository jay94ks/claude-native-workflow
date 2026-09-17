// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 인스턴스
// 메시징(대기/처리중/기록 상태 구분). cli/index.ts에서 그대로 잘라낸 것
// - 로직은 전혀 안 바뀜. 원래 물리적으로 "git push 훅" 섹션 바로 뒤에
// 헤더 없이 이어져 있었다 - 별도 도메인이라 갈라냄.
import type { Command } from "commander";
import { apiCall, waitForMessageDirect } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerMessageCommands(program: Command): void {
  const messageCmd = program.command("message").description("인스턴스 메시징 - 대기(미확인)/처리중(ack함)/기록(complete함) 상태 구분");
  messageCmd
    .command("list <projectId>")
    .option("--status <s>", "pending|processing|delivered|active|all(기본 active - 기록/완료된 메시지는 빼고 아직 처리 안 끝난 것만)")
    .option("--origin <o>", "designer|ai - 생략하면 방향 구분 없이 전체(#message-origin-tagging, CLI/MCP로 보낸 메시지는 자동으로 ai)")
    .option(
      "--page <n>",
      "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열. 주의: 페이지네이션 응답에선 deliveredAt 자동 갱신이 안 됨(웹 화면과 공유하는 라우트라 markDelivered 미지원)",
    )
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .description(
      "CLI로 조회해도 상태는 안 바뀐다(읽음은 ack와 별개) - 대기 상태였던 메시지의 deliveredAt만 자동 갱신. " +
        "--status를 생략하면 기본으로 active(대기+처리중)만 보여주고 기록(완료)된 메시지는 안 보낸다 - 전체 이력이 필요하면 --status all.",
    )
    .action((projectId, opts) => {
      const status = opts.status ?? "active";
      const paged = opts.page !== undefined || opts.count !== undefined;
      if (paged) {
        const qs = new URLSearchParams({ status, page: opts.page ?? "1", pageSize: opts.count ?? "20", ...(opts.origin ? { origin: opts.origin } : {}) });
        return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/page?${qs}`)));
      }
      const qs = new URLSearchParams({ markDelivered: "true", status, ...(opts.origin ? { origin: opts.origin } : {}) });
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages?${qs}`)));
    });
  messageCmd
    .command("send <projectId> <body...>")
    .description("이 명령으로 보낸 메시지는 origin이 자동으로 ai로 기록된다(#message-origin-tagging - CLI는 항상 X-Client-Kind: cli를 붙이는 공유 클라이언트를 거침)")
    .action((projectId, bodyParts) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify({ body: bodyParts.join(" ") }) }))),
    );
  messageCmd
    .command("wait <projectId>")
    .option("--timeout <sec>", "전체 대기 시간(초) - EMQX 직접 구독이 가능하면 그걸로 대기하고, 안 되면 10초 단위 HTTP 폴링으로 자동 폴백", "60")
    .action((projectId, opts) => run(async () => printJson(await waitForMessageDirect(projectId, Number(opts.timeout)))));
  messageCmd
    .command("recent <projectId>")
    .option("--limit <n>", "기본 20")
    .description("장애 복구용 - 상태를 바꾸지 않는 순수 조회(반복 호출해도 안전), 대기/기록 구분 없이 최신순")
    .action((projectId, opts) => {
      const qs = opts.limit ? `?limit=${encodeURIComponent(opts.limit)}` : "";
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/messages/recent${qs}`)));
    });
  messageCmd
    .command("edit <id> <body...>")
    .description("본인이 보낸 메시지만 수정할 수 있다")
    .action((id, bodyParts) =>
      run(async () =>
        printJson(await apiCall(`/api/messages/${id}`, { method: "PUT", body: JSON.stringify({ body: bodyParts.join(" ") }) })),
      ),
    );
  messageCmd
    .command("delete <id>")
    .description("본인이 보낸 메시지만 삭제할 수 있다")
    .action((id) => run(async () => printJson(await apiCall(`/api/messages/${id}`, { method: "DELETE" }))));
  messageCmd
    .command("ack <id>")
    .description("대기 → 처리중으로 표시(프로젝트 멤버 누구나 가능, 이미 처리중/기록이면 그대로)")
    .action((id) => run(async () => printJson(await apiCall(`/api/messages/${id}/ack`, { method: "PUT" }))));
  messageCmd
    .command("complete <id>")
    .description("처리중 → 기록으로 표시(ack 없이 불러도 자동으로 ack까지 됨, 이미 기록이면 그대로)")
    .action((id) => run(async () => printJson(await apiCall(`/api/messages/${id}/complete`, { method: "PUT" }))));
}
