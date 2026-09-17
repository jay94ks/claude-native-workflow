// 배치 2e(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// 의견(Opinion) - 코멘트와 정반대 채널. mcp/server.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜.
//
// 코멘트는 "설계자들끼리만 공유, AI 참고 지표가 될 수 없다"는 원칙으로
// CLI/MCP가 없는데, 의견은 AI가 참고해야 하는 채널이라 그 반대다 -
// 문서/계획 화면의 "의견" 버튼으로 설계자가 남기고, AI가 여기서 직접
// 조회·확인 완료 처리한다. 생성 도구는 의도적으로 없음(설계자가
// 웹에서만 남긴다).
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerOpinionTools(tool: ToolRegistrar): void {
  tool(
    "opinion_pending",
    "아직 확인하지 않은 의견 목록",
    "status가 open인 Opinion 목록 - 문서/계획을 다시 열었을 때 응답의 notices에도 같은 신호가 뜨지만, 프로젝트 전체를 한 번에 훑고 싶을 때 이걸 쓴다.",
    { projectId: z.string() },
    async (a) => call(`/api/opinions?${new URLSearchParams({ projectId: a.projectId as string, status: "open" })}`),
  );
  tool(
    "opinion_list",
    "의견 목록 조회",
    "targetTrackingCode를 주면 그 문서/계획의 의견만, status로 상태 제한(기본 open, all로 전체 이력).",
    { projectId: z.string(), targetTrackingCode: z.string().optional(), status: z.enum(["open", "resolved", "all"]).optional() },
    async (a) => {
      const qs = new URLSearchParams({ projectId: a.projectId as string, status: (a.status as string) ?? "open" });
      if (a.targetTrackingCode) qs.set("targetKey", a.targetTrackingCode as string);
      return call(`/api/opinions?${qs}`);
    },
  );
  tool(
    "opinion_resolve",
    "의견 확인 완료 표시",
    "해당 의견을 resolved로 표시한다 - 되돌리기는 지원 안 함(다시 논의가 필요하면 설계자가 새 의견을 남기는 게 자연스럽다).",
    { opinionId: z.string() },
    async (a) => call(`/api/opinions/${a.opinionId}/resolve`, { method: "POST" }),
  );

  // 코멘트는 설계자들끼리만 쓰는 채널이다(웹 UI 전용) - AI의 참고
  // 지표가 될 수 없어 의도적으로 도구를 두지 않는다("CLI/MCP 명령어
  // 완전성" 원칙의 의도적 예외 - 소스 코드/칸반 카드 코멘트도 동일).
}
