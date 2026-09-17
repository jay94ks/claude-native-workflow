// 배치 2i(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 보고서.
// mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerReportTools(tool: ToolRegistrar): void {
  tool(
    "report_new",
    "보고서 생성",
    "여러 문서를 링크로 엮는 보고서를 생성한다. 응답에 본문은 없음(호출자가 이미 보낸 내용) - 본문이 필요하면 document_get/document_read/document_grep으로 이어서 조회.",
    { projectId: z.string(), title: z.string(), body: z.string(), links: z.array(z.string()).optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/reports`, {
        method: "POST",
        body: JSON.stringify({ title: a.title, body: a.body, links: a.links }),
      }),
  );
}
