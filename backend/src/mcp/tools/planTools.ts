// 배치 2j(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 보류
// 계획(PN). mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// Document/DocType/DocStatus 체계와 완전히 별도로 관리되는 독립
// 엔티티 - 작업 중 "이건 나중에 따로 계획을 잡아야 한다"고 판단한
// 항목을 모아두는 체크리스트. 상태는 5개 고정(plan_statuses로 조회
// 가능), 전이 제약 없음.
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerPlanTools(tool: ToolRegistrar): void {
  tool(
    "plan_new",
    "계획 생성",
    "별도 계획이 필요한 항목을 새로 만든다(문서와 별개 체계) - status를 생략하면 planned로 시작. dependsOn은 이 계획보다 먼저 끝나야 하는 선행 조건 계획들의 trackingCode.",
    {
      projectId: z.string(),
      title: z.string(),
      body: z.string(),
      status: z.enum(["planned", "pending_approval", "in_review", "scheduled", "completed", "rejected"]).optional(),
      refs: z.array(z.string()).optional(),
      dependsOn: z.array(z.string()).optional(),
    },
    async (a) =>
      call(`/api/projects/${a.projectId}/plans`, {
        method: "POST",
        body: JSON.stringify({ title: a.title, body: a.body, status: a.status, refs: a.refs, dependsOn: a.dependsOn }),
      }),
  );
  tool(
    "plan_list",
    "계획 목록",
    "이 프로젝트의 계획 목록(페이지네이션, 기본 본문 제외 요약만 - full:true로 전체, 본문이 필요하면 plan_get으로 이어서 조회해도 됨) - status/q로 제한 가능. 기본 정렬은 의존도(선행 조건 개수)가 가장 낮은 순(지금 바로 시작할 수 있는 계획이 위로) - sort:\"updatedAt:desc\"로 예전 방식(최근 수정순)으로 바꿀 수 있다.",
    {
      projectId: z.string(),
      status: z.string().optional(),
      q: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
      sort: z.enum(["dependencyCount:asc", "updatedAt:desc"]).optional(),
      full: z.boolean().optional(),
    },
    async (a) => {
      const qs = new URLSearchParams({
        ...(a.status ? { status: String(a.status) } : {}),
        ...(a.q ? { q: String(a.q) } : {}),
        page: String(a.page ?? 1),
        pageSize: String(a.pageSize ?? 20),
        ...(a.sort ? { sort: String(a.sort) } : {}),
        ...(a.full ? { full: "true" } : {}),
      });
      return call(`/api/projects/${a.projectId}/plans?${qs}`);
    },
  );
  tool("plan_statuses", "계획 상태 목록", "계획 상태로 쓸 수 있는 코드/라벨 목록(고정값).", {}, async () => call(`/api/plans/statuses`));
  tool(
    "plan_get",
    "계획 상세",
    "계획 상세(관련 문서 포함).",
    { trackingCode: z.string() },
    async (a) => call(`/api/plans/${a.trackingCode}`),
  );
  tool(
    "plan_set",
    "계획 수정",
    "제목/본문을 수정한다(둘 중 준 것만 바뀜).",
    { trackingCode: z.string(), title: z.string().optional(), body: z.string().optional() },
    async (a) => call(`/api/plans/${a.trackingCode}`, { method: "PUT", body: JSON.stringify({ title: a.title, body: a.body }) }),
  );
  tool(
    "plan_status",
    "계획 상태 변경",
    "계획 상태를 바꾼다 - planned|pending_approval|in_review|scheduled|completed|rejected 중 하나(전이 제약 없음).",
    { trackingCode: z.string(), status: z.enum(["planned", "pending_approval", "in_review", "scheduled", "completed", "rejected"]) },
    async (a) => call(`/api/plans/${a.trackingCode}/status`, { method: "PUT", body: JSON.stringify({ status: String(a.status) }) }),
  );
  tool(
    "plan_delete",
    "계획 삭제",
    "계획을 삭제한다.",
    { trackingCode: z.string() },
    async (a) => call(`/api/plans/${a.trackingCode}`, { method: "DELETE" }),
  );
  tool(
    "plan_link",
    "계획에 관련 문서 추가",
    "계획에 관련 문서를 추가한다.",
    { trackingCode: z.string(), docTrackingCode: z.string() },
    async (a) => call(`/api/plans/${a.trackingCode}/refs`, { method: "POST", body: JSON.stringify({ trackingCode: a.docTrackingCode }) }),
  );
  tool(
    "plan_unlink",
    "계획에서 관련 문서 제거",
    "계획에서 관련 문서를 제거한다.",
    { trackingCode: z.string(), docTrackingCode: z.string() },
    async (a) => call(`/api/plans/${a.trackingCode}/refs/${a.docTrackingCode}`, { method: "DELETE" }),
  );
  tool(
    "plan_depend",
    "계획에 선행 조건 추가",
    "이 계획에 선행 조건(먼저 끝나야 하는 다른 계획)을 추가한다 - 여러 개면 하나씩 호출.",
    { trackingCode: z.string(), dependsOnTrackingCode: z.string() },
    async (a) =>
      call(`/api/plans/${a.trackingCode}/dependencies`, { method: "POST", body: JSON.stringify({ trackingCode: a.dependsOnTrackingCode }) }),
  );
  tool(
    "plan_undepend",
    "계획에서 선행 조건 제거",
    "계획에서 선행 조건을 제거한다.",
    { trackingCode: z.string(), dependsOnTrackingCode: z.string() },
    async (a) => call(`/api/plans/${a.trackingCode}/dependencies/${a.dependsOnTrackingCode}`, { method: "DELETE" }),
  );
  tool(
    "plan_export",
    "계획 전체 내보내기",
    "이 프로젝트의 계획을 조건에 맞는 전체(페이지 상한 없음) 배열로 반환한다 - 그대로 파일에 저장하면 \"계획을 하나의 파일로 bulk\"가 된다. plan_list와 달리 페이지네이션이 없다. 기본 정렬은 plan_list와 동일하게 의존도가 가장 낮은 순.",
    {
      projectId: z.string(),
      status: z.string().optional(),
      q: z.string().optional(),
      sort: z.enum(["dependencyCount:asc", "updatedAt:desc"]).optional(),
    },
    async (a) => {
      const qs = new URLSearchParams({
        ...(a.status ? { status: String(a.status) } : {}),
        ...(a.q ? { q: String(a.q) } : {}),
        ...(a.sort ? { sort: String(a.sort) } : {}),
      });
      return call(`/api/projects/${a.projectId}/plans/export?${qs}`);
    },
  );
  const planImportItemObject = z.object({
    title: z.string(),
    body: z.string(),
    status: z.enum(["planned", "pending_approval", "in_review", "scheduled", "completed", "rejected"]).optional(),
    refs: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
  });
  tool(
    "plan_bulk_import",
    "계획 일괄 생성",
    "여러 계획 정의를 배열로 한 번에 만든다. 항목별 성공/실패 결과 배열을 반환(부분 성공 허용) - refs/dependsOn은 이미 존재하는 문서/계획만 가리킬 수 있고, 같은 배치 안의 다른 항목은 가리킬 수 없다(그 항목의 trackingCode는 생성 전엔 알 수 없음 - 필요하면 만든 뒤 plan_link/plan_depend로 연결).",
    { projectId: z.string(), items: z.array(planImportItemObject) },
    async (a) => call(`/api/projects/${a.projectId}/plans/import`, { method: "POST", body: JSON.stringify({ items: a.items }) }),
  );
  tool(
    "plan_bulk_status",
    "계획 상태 일괄 변경",
    "여러 계획을 한 번에 같은 상태로 바꾼다. 항목별 성공/실패 결과 배열을 반환(부분 성공 허용).",
    { trackingCodes: z.array(z.string()), status: z.enum(["planned", "pending_approval", "in_review", "scheduled", "completed", "rejected"]) },
    async (a) => call(`/api/plans/bulk-status`, { method: "POST", body: JSON.stringify({ trackingCodes: a.trackingCodes, status: a.status }) }),
  );
  tool(
    "plan_bulk_link",
    "계획 일괄 관련 문서 추가",
    "여러 계획에 같은 관련 문서를 한 번에 추가한다. 항목별 성공/실패 결과 배열을 반환(부분 성공 허용).",
    { trackingCodes: z.array(z.string()), docTrackingCode: z.string() },
    async (a) =>
      call(`/api/plans/bulk-link`, { method: "POST", body: JSON.stringify({ trackingCodes: a.trackingCodes, docTrackingCode: a.docTrackingCode }) }),
  );
  tool(
    "plan_bulk_depend",
    "계획 일괄 선행 조건 추가",
    "여러 계획에 같은 선행 조건을 한 번에 추가한다. 항목별 성공/실패 결과 배열을 반환(부분 성공 허용).",
    { trackingCodes: z.array(z.string()), dependsOnTrackingCode: z.string() },
    async (a) =>
      call(`/api/plans/bulk-depend`, {
        method: "POST",
        body: JSON.stringify({ trackingCodes: a.trackingCodes, dependsOnTrackingCode: a.dependsOnTrackingCode }),
      }),
  );
}
