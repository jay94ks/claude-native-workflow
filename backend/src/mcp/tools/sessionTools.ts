// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 세션/동시
// 작업 등록(SP-976DD4ED, #multi-session-workclaim). mcp/server.ts에서
// 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. 계정 전체 스코프 - 같은
// 계정으로 여러 Claude 세션을 동시에 띄울 때 서로를 구분하고
// (X-Session-Id 헤더는 이 MCP 서버가 공유하는 apiFetch()가 이미 자동으로
// 붙임, 이 도구들엔 그 인자가 없음) "지금 뭘 작업 중인지"를 광고판처럼
// 등록해 다른 세션에 알린다 - 락이 아니라 경고용(WorkClaim이 있어도
// 저장/전이는 그대로 진행되고 관련 mutation 응답의 notices에 경고만
// 뜬다). session(세션 자체)과 work(WorkClaim)는 밀접히 연관돼 한
// 파일에 같이 둔다.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerSessionTools(tool: ToolRegistrar): void {
  tool(
    "session_list",
    "내 세션 목록",
    "내 계정으로 지금까지/최근 활동한 세션들의 이름/클라이언트 종류/마지막 활동 시각을 조회한다.",
    { minutes: z.number().optional() },
    async (a) => {
      const qs = a.minutes !== undefined ? `?minutes=${encodeURIComponent(String(a.minutes))}` : "";
      return call(`/api/sessions${qs}`);
    },
  );
  tool(
    "session_rename",
    "내 세션 이름 변경",
    "본인 소유 세션만 이름을 바꿀 수 있다 - 다른 세션 이름은 못 바꿈.",
    { sessionId: z.string(), name: z.string() },
    async (a) => call(`/api/sessions/${a.sessionId}/name`, { method: "PUT", body: JSON.stringify({ name: a.name }) }),
  );
  tool(
    "project_sessions_list",
    "이 프로젝트에서 활동한 세션 목록",
    "이 프로젝트에서 WorkClaim을 남긴 적 있는 세션들을 어떤 설계자의 어떤 세션인지와 함께, 최근 활동순으로 페이지네이션 조회한다.",
    { projectId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/projects/${a.projectId}/sessions/page?${qs}`);
    },
  );
  tool(
    "work_claim",
    "작업 중 등록(WorkClaim)",
    "targetType(document/plan/sourceFile)+targetKey 대상을 지금 작업 중이라고 등록한다 - 명시적으로 부를 때만 생기고, 락이 아니라 다른 세션에게 보이는 광고판일 뿐이다(실제 저장/전이를 막지 않음).",
    { projectId: z.string(), targetType: z.enum(["document", "plan", "sourceFile"]), targetKey: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/work-claims`, {
        method: "POST",
        body: JSON.stringify({ targetType: a.targetType, targetKey: a.targetKey }),
      }),
  );
  tool(
    "work_release",
    "작업 중 등록 해제",
    "work_claim으로 등록한 클레임을 해제한다(작업이 끝났거나 더 이상 유효하지 않을 때).",
    { projectId: z.string(), targetType: z.enum(["document", "plan", "sourceFile"]), targetKey: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/work-claims`, {
        method: "DELETE",
        body: JSON.stringify({ targetType: a.targetType, targetKey: a.targetKey }),
      }),
  );
  tool(
    "work_list",
    "이 프로젝트의 현재 작업 현황",
    "이 프로젝트에서 지금 살아있는(최근 활동한) 세션들이 뭘 작업 중인지 조회한다.",
    { projectId: z.string(), minutes: z.number().optional() },
    async (a) => {
      const qs = a.minutes !== undefined ? `?minutes=${encodeURIComponent(String(a.minutes))}` : "";
      return call(`/api/projects/${a.projectId}/work-claims${qs}`);
    },
  );
}
