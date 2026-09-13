// RelationGraphCanvas.vue와 RelationsView.vue가 공유하는 그래프 노드/
// 엣지 모양 - Cytoscape에 그대로 넘기기 전 단계의 화면 전용 표현.

export interface RelationGraphNode {
  id: string;
  label: string;
  // 하위 관계가 있는데 아직 안 펼쳐졌으면 점선 테두리로 표시(펼칠
  // 여지가 있다는 신호).
  hasUnexpandedChildren?: boolean;
  // 검색/태그 필터에 실제로 매칭된 노드인지(강조 색상용).
  tagged?: boolean;
  // 네트워크형 뷰의 색상 구분 키 - tags[0](대표 태그, 다대다라 순서
  // 없어 다소 임의적이지만 무태그 시 중립색 폴백이면 실사용엔 충분).
  primaryTag?: string;
}

export interface RelationGraphEdge {
  id: string; // `${fromId}->${toId}`
  from: string; // DB CodeRelationEdge.fromId(자식/하위) - sharedTag는 방향 없음, 둘 중 하나
  to: string; // DB CodeRelationEdge.toId(부모/상위) - sharedTag는 방향 없음, 둘 중 하나
  // parentChild(기존, 기본값) - DB의 실제 부모/자식 관계, 화면에서
  // 부모→자식 화살표 + 실선. sharedTag(신규, #relation-graph-tag-edges) -
  // 태그를 하나라도 공유하는 노드끼리 점선으로 연결(방향 없음, 화살표
  // 없음) - 설계자 지시.
  kind?: "parentChild" | "sharedTag";
}

// 태그 문자열을 고정 팔레트 색상으로 해싱 - 같은 태그는 항상 같은
// 색이 되어야 그래프를 다시 그려도(펼치기 등) 시각적으로 일관된다.
const TAG_PALETTE = ["#e05a5a", "#e0955a", "#d4b83a", "#6aab5c", "#4aa3a3", "#4a7dd6", "#8a6bd6", "#c25ba8"];
const NEUTRAL_TAG_COLOR = "#9aa1ac";

export function colorForTag(tag: string | undefined): string {
  if (!tag) return NEUTRAL_TAG_COLOR;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}
