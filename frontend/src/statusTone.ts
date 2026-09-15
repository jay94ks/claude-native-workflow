// Document(DocStatus)와 Plan(PLAN_STATUSES)의 상태 코드는 서로 다른
// 어휘를 쓰지만(예: draft vs planned) 코드 문자열 자체가 겹치지 않아
// 하나의 맵으로 합쳐도 안전하다 - StatusBadge.vue가 이 맵으로 상태
// 코드 → 색상 톤을 결정한다.
export type StatusTone = "neutral" | "info" | "warning" | "success" | "purple" | "danger";

const STATUS_TONES: Record<string, StatusTone> = {
  // Document (backend/src/core/docTypes.ts STANDARD_DOC_STATUSES)
  draft: "neutral",
  review: "info",
  pending: "warning",
  approved: "success",
  deprecated: "purple",
  archived: "neutral",
  // Plan (backend/src/core/plans.ts PLAN_STATUSES)
  planned: "neutral",
  pending_approval: "warning",
  in_review: "info",
  scheduled: "purple",
  completed: "success",
  rejected: "danger",
};

export function statusTone(code: string): StatusTone {
  return STATUS_TONES[code] ?? "neutral";
}
