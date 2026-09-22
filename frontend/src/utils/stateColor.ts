// 여러 화면(DocTypeWorkspace/DiscussionItemCard/RecentQaFeed/PullRequestsTab)
// 이 각자 손으로 복제해두고 있던 상태→색상 매핑을 하나로 합쳤다 - 상태 값
// 하나를 추가/변경할 때 일부 화면만 반영되고 나머지는 회색/기본색으로
// 잘못 보이는 것을 막기 위함. documentRules.ts/PR state 전체를 아우르는
// superset(DocTypeWorkspace가 갖고 있던 것 - active/resumed도 처리)을 기준으로 삼는다.
export function stateColor(state: string): string {
  if (state === "done" || state === "ended" || state === "merged") return "positive";
  if (state === "discard" || state === "canceled" || state === "closed") return "grey-6";
  if (state === "active" || state === "resumed") return "orange";
  return "primary";
}
