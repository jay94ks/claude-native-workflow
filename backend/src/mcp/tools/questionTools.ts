// 배치 2k(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 질의/
// 답변 + 프로젝트 대시보드/활동 이력. mcp/server.ts에서 그대로 잘라낸
// 것 - 로직은 전혀 안 바뀜.
//
// targetType/targetKey로 다형화됨(document/source/kanbanCard) - document/
// kanbanCard 대상은 그 자신의 트래킹 코드만으로 서버가 대상 종류를
// 자동 판별한다(resolveTargetByTrackingCode). source 대상은 트래킹
// 코드가 없어 별도 도구가 필요하다.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerQuestionTools(tool: ToolRegistrar): void {
  tool(
    "question_add",
    "질의 등록",
    "문서/칸반 카드에 대한 질의를 등록하고 추적 코드를 발급받는다(질의는 AI가 등록, 설계자가 답변) - kind로 승인 요청(approval)/답변 요청(answer, 기본값)을 구분하고, refs로 판단에 참고한 문서를 태깅할 수 있다. options로 설계자가 고를 수 있는 제안 선택지(라벨+부가정보)를 같이 제시할 수 있다 - 클릭하면 답변 입력칸에 라벨이 채워질 뿐 자동 제출은 안 됨.",
    {
      trackingCode: z.string(),
      text: z.string(),
      kind: z.enum(["approval", "answer"]).optional(),
      refs: z.array(z.string()).optional(),
      options: z.array(z.object({ label: z.string(), detail: z.string().optional() })).optional(),
    },
    async (a) =>
      call(`/api/questions`, {
        method: "POST",
        body: JSON.stringify({ trackingCode: a.trackingCode, kind: a.kind ?? "answer", text: a.text, refs: a.refs, options: a.options }),
      }),
  );
  tool(
    "question_add_source",
    "소스 코드 파일에 질의 등록",
    "문서/칸반 카드가 아닌 소스 코드 파일에 AI 질의를 등록한다 - kind/refs/options는 question_add와 동일.",
    {
      projectId: z.string(),
      path: z.string(),
      text: z.string(),
      kind: z.enum(["approval", "answer"]).optional(),
      refs: z.array(z.string()).optional(),
      options: z.array(z.object({ label: z.string(), detail: z.string().optional() })).optional(),
    },
    async (a) =>
      call(`/api/projects/${a.projectId}/questions/source`, {
        method: "POST",
        body: JSON.stringify({ path: a.path, kind: a.kind ?? "answer", text: a.text, refs: a.refs, options: a.options }),
      }),
  );
  tool(
    "question_list",
    "문서/칸반 카드의 질의/답변 조회",
    "한 대상의 질의를 답변과 함께 순서대로 조회한다. status를 생략하면 기본 active(open+pending)만 보여주고 이미 처리된(resolved+withdrawn) 질의는 빼며, 특정 상태나 all(전체)도 지정 가능. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    {
      trackingCode: z.string(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
      status: z.enum(["open", "pending", "resolved", "withdrawn", "active", "all"]).optional(),
    },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      if (!paged) {
        const qs = new URLSearchParams({ trackingCode: String(a.trackingCode), ...(a.status ? { status: String(a.status) } : {}) });
        return call(`/api/questions?${qs}`);
      }
      const qs = new URLSearchParams({
        trackingCode: String(a.trackingCode),
        page: String(a.page ?? 1),
        pageSize: String(a.pageSize ?? 20),
        ...(a.status ? { status: String(a.status) } : {}),
      });
      return call(`/api/questions/page?${qs}`);
    },
  );
  tool(
    "question_list_source",
    "소스 코드 파일의 질의/답변 조회",
    "소스 코드 파일에 달린 질의를 조회한다. status를 생략하면 기본 active(open+pending)만 보여주고 이미 처리된(resolved+withdrawn) 질의는 빼며, 특정 상태나 all(전체)도 지정 가능. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    {
      projectId: z.string(),
      path: z.string(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
      status: z.enum(["open", "pending", "resolved", "withdrawn", "active", "all"]).optional(),
    },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      if (!paged) {
        const qs = new URLSearchParams({ path: String(a.path), ...(a.status ? { status: String(a.status) } : {}) });
        return call(`/api/projects/${a.projectId}/questions/source?${qs}`);
      }
      const qs = new URLSearchParams({
        path: String(a.path),
        page: String(a.page ?? 1),
        pageSize: String(a.pageSize ?? 20),
        ...(a.status ? { status: String(a.status) } : {}),
      });
      return call(`/api/projects/${a.projectId}/questions/source/page?${qs}`);
    },
  );
  tool(
    "pending_list",
    "미해결 질의 목록",
    "프로젝트의 미해결(open+pending) 질의 목록 - pending은 설계자가 답변했지만 AI가 아직 확인 안 한 것. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { projectId: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/projects/${a.projectId}/pending`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/projects/${a.projectId}/pending/page?${qs}`);
    },
  );
  tool(
    "project_dashboard",
    "프로젝트 진행 상황 대시보드",
    "프로젝트 진행 상황 요약(문서 상태 분포+정체 문서, 미답변 Q&A, 처리 안 된 메시지, 칸반 컬럼별 카드 수, 최근 활동) - 웹 홈 화면과 같은 데이터.",
    { projectId: z.string(), staleDays: z.number().int().optional() },
    async (a) => {
      const qs = a.staleDays !== undefined ? `?staleDays=${a.staleDays}` : "";
      return call(`/api/projects/${a.projectId}/dashboard${qs}`);
    },
  );
  tool(
    "project_activity",
    "프로젝트 최근 활동 전체 목록",
    "프로젝트 최근 활동 전체 목록(문서 생성/수정, 질의, 답변, 코멘트, 메시지, 칸반 카드 생성) - project_dashboard의 최근 활동(20건 고정) 더보기용, 기본 100건.",
    { projectId: z.string(), limit: z.number().int().optional() },
    async (a) => {
      const qs = a.limit !== undefined ? `?limit=${a.limit}` : "";
      return call(`/api/projects/${a.projectId}/activity${qs}`);
    },
  );
  tool(
    "question_reply",
    "질의에 답변",
    "질의에 답변하면 상태가 pending으로 바뀌고(종결 아님 - AI 확인 대기), 문서 대상의 모든 질의가 open을 벗어나면 문서 상태도 자동 전이될 수 있다. kind=answer면 body가 필요하다. kind=approval이면 decision(+선택 body 메모)으로 승인/거부를 확정하거나, 아직 결정 전이면 decision 없이 body만으로도 답할 수 있다(둘 중 최소 하나 필요).",
    { questionTrackingCode: z.string(), body: z.string().optional(), decision: z.enum(["approved", "rejected"]).optional() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/answer`, { method: "POST", body: JSON.stringify({ body: a.body, decision: a.decision }) }),
  );
  tool(
    "question_ack",
    "질의 확인 완료 표시",
    "설계자가 답변한(pending) 질의를 확인 완료(resolved)로 표시한다 - pending 목록에 쌓인 것을 처리할 때 씀.",
    { questionTrackingCode: z.string() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/ack`, { method: "POST" }),
  );
  tool(
    "question_ack_bulk",
    "질의 일괄 확인 완료 표시",
    "여러 pending 질의를 한 번에 확인 완료로 표시한다 - 항목별 결과({trackingCode, ok, error?})를 반환하며 일부만 실패해도 나머지는 계속 진행된다. 마이그레이션 직후처럼 pending이 몰려 있을 때 씀.",
    { trackingCodes: z.array(z.string()) },
    async (a) => call(`/api/questions/bulk-ack`, { method: "POST", body: JSON.stringify({ trackingCodes: a.trackingCodes }) }),
  );
  tool(
    "question_withdraw",
    "질의 철회",
    "본인이 등록한 질문 중 아직 답변되지 않은(open) 것을 철회한다 - 더 이상 유효하지 않게 된 질문을 정리할 때 씀.",
    { questionTrackingCode: z.string() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/withdraw`, { method: "POST" }),
  );
}
