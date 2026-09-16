// 사용 모니터링(core/monitoring.ts) 전용 - raw HTTP method+route를
// 사람이 읽는 CLI/MCP 명령 이름으로 바꿔주는 정적 매핑. 설계자가
// 이 통계를 SKILL.md 같은 지침 문서와 나란히 두고 비교하려는 목적이라
// (#usage-monitoring), route 그대로 보여주는 것보다 명령 이름으로
// 보여야 의미가 있다. **전체 라우트를 다 담지는 않는다** - 문서/계획/
// 의견/코멘트/질의/코드리뷰/메시지/칸반/검색처럼 실제로 자주 쓰이는
// 핵심 영역만 우선 채웠고, 매핑이 없는 라우트는 raw route로 그대로
// 표시된다(기능이 죽지 않음). 새 CLI/MCP 명령을 만들 때 SKILL.md와
// 함께 이 표도 같이 갱신한다(CLAUDE.md "CLAUDE.md/SKILL.md 동기화"
// 규칙 참고).

export interface MonitoringRegistryEntry {
  method: string;
  routePattern: string;
  cli: string;
  mcp: string;
}

export const MONITORING_REGISTRY: MonitoringRegistryEntry[] = [
  // 문서
  { method: "POST", routePattern: "/api/projects/:projectId/documents", cli: "docs new", mcp: "document_new" },
  { method: "GET", routePattern: "/api/projects/:projectId/documents", cli: "docs list", mcp: "document_list" },
  { method: "GET", routePattern: "/api/projects/:projectId/documents/page", cli: "docs list --page", mcp: "document_list_page" },
  { method: "GET", routePattern: "/api/projects/:projectId/search", cli: "docs search", mcp: "document_search" },
  { method: "GET", routePattern: "/api/projects/:projectId/search-all", cli: "docs search-all", mcp: "search_all" },
  { method: "GET", routePattern: "/api/refs-status/:trackingCode", cli: "docs refs-status", mcp: "refs_status" },
  { method: "GET", routePattern: "/api/documents/:trackingCode", cli: "docs get", mcp: "document_get" },
  { method: "PUT", routePattern: "/api/documents/:trackingCode", cli: "docs save", mcp: "document_save" },
  { method: "PUT", routePattern: "/api/documents/:trackingCode/patch", cli: "docs patch", mcp: "document_patch" },
  { method: "POST", routePattern: "/api/documents/:trackingCode/transition", cli: "docs transition", mcp: "document_transition" },
  { method: "DELETE", routePattern: "/api/documents/:trackingCode", cli: "docs delete", mcp: "document_delete" },
  { method: "GET", routePattern: "/api/documents/:trackingCode/lines", cli: "docs read", mcp: "document_read" },
  { method: "GET", routePattern: "/api/documents/:trackingCode/grep", cli: "docs grep", mcp: "document_grep" },

  // 계획
  { method: "POST", routePattern: "/api/projects/:projectId/plans", cli: "docs plan new", mcp: "plan_new" },
  { method: "GET", routePattern: "/api/projects/:projectId/plans", cli: "docs plan list", mcp: "plan_list" },
  { method: "GET", routePattern: "/api/plans/:trackingCode", cli: "docs plan get", mcp: "plan_get" },
  { method: "PUT", routePattern: "/api/plans/:trackingCode", cli: "docs plan set", mcp: "plan_set" },
  { method: "PUT", routePattern: "/api/plans/:trackingCode/status", cli: "docs plan status", mcp: "plan_status" },
  { method: "DELETE", routePattern: "/api/plans/:trackingCode", cli: "docs plan delete", mcp: "plan_delete" },

  // 의견
  { method: "POST", routePattern: "/api/opinions", cli: "(웹 전용)", mcp: "(웹 전용)" },
  { method: "GET", routePattern: "/api/opinions", cli: "docs opinion list/pending", mcp: "opinion_list / opinion_pending" },
  { method: "POST", routePattern: "/api/opinions/:id/resolve", cli: "docs opinion resolve", mcp: "opinion_resolve" },

  // 코멘트(설계자 전용 - CLI/MCP 없음, 웹에서만 옴)
  { method: "POST", routePattern: "/api/comments", cli: "(웹 전용)", mcp: "(웹 전용)" },
  { method: "GET", routePattern: "/api/comments", cli: "(웹 전용)", mcp: "(웹 전용)" },
  { method: "PUT", routePattern: "/api/comments/:id", cli: "(웹 전용)", mcp: "(웹 전용)" },
  { method: "DELETE", routePattern: "/api/comments/:id", cli: "(웹 전용)", mcp: "(웹 전용)" },

  // 질의/답변
  { method: "POST", routePattern: "/api/questions", cli: "docs question", mcp: "question_ask" },
  { method: "GET", routePattern: "/api/questions", cli: "docs questions", mcp: "question_list" },
  { method: "GET", routePattern: "/api/questions/page", cli: "docs pending", mcp: "pending_list" },
  { method: "POST", routePattern: "/api/questions/:trackingCode/answer", cli: "docs reply", mcp: "question_reply" },
  { method: "POST", routePattern: "/api/questions/:trackingCode/ack", cli: "docs question-ack", mcp: "question_ack" },

  // 코드 리뷰
  { method: "POST", routePattern: "/api/projects/:projectId/git/code-review/request", cli: "docs code-review request", mcp: "code_review_request" },
  { method: "GET", routePattern: "/api/projects/:projectId/git/code-review/pending", cli: "docs code-review pending", mcp: "code_review_pending" },
  { method: "GET", routePattern: "/api/projects/:projectId/git/code-review", cli: "docs code-review list", mcp: "code_review_list" },
  { method: "GET", routePattern: "/api/projects/:projectId/git/code-review/file-history", cli: "docs code-review file-history", mcp: "code_review_file_history" },
  { method: "GET", routePattern: "/api/projects/:projectId/git/code-review/:reviewId", cli: "docs code-review get", mcp: "code_review_get" },
  { method: "POST", routePattern: "/api/projects/:projectId/git/code-review/:reviewId/submit", cli: "docs code-review submit", mcp: "code_review_submit" },
  { method: "POST", routePattern: "/api/projects/:projectId/git/code-review/findings/:findingId/resolve", cli: "docs code-review resolve-finding", mcp: "code_review_resolve_finding" },
  { method: "POST", routePattern: "/api/projects/:projectId/git/code-review/:reviewId/comments", cli: "docs code-review comment-add", mcp: "code_review_comment_add" },
  { method: "DELETE", routePattern: "/api/projects/:projectId/git/code-review/:reviewId", cli: "docs code-review delete", mcp: "code_review_delete" },

  // 메시지
  { method: "GET", routePattern: "/api/projects/:projectId/messages", cli: "docs message list", mcp: "message_list" },
  { method: "POST", routePattern: "/api/projects/:projectId/messages", cli: "docs message send", mcp: "message_send" },
  { method: "PUT", routePattern: "/api/messages/:id/ack", cli: "docs message ack", mcp: "message_ack" },
  { method: "PUT", routePattern: "/api/messages/:id/complete", cli: "docs message complete", mcp: "message_complete" },

  // 칸반
  { method: "GET", routePattern: "/api/projects/:projectId/kanban/columns", cli: "docs kanban-columns", mcp: "kanban_columns" },
  { method: "POST", routePattern: "/api/projects/:projectId/kanban/cards", cli: "docs kanban-card-new", mcp: "kanban_card_new" },
  { method: "GET", routePattern: "/api/projects/:projectId/kanban/cards", cli: "docs kanban-cards", mcp: "kanban_cards" },
];

const registryIndex = new Map<string, MonitoringRegistryEntry>(
  MONITORING_REGISTRY.map((e) => [`${e.method} ${e.routePattern}`, e]),
);

/** 매핑이 없으면 null - 호출부가 raw "method routePattern"으로
 * 그대로 표시(기능이 죽지 않음). */
export function lookupMonitoringLabel(method: string, routePattern: string): MonitoringRegistryEntry | null {
  return registryIndex.get(`${method} ${routePattern}`) ?? null;
}
