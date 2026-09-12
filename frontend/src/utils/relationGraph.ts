// RelationGraphCanvas.vue와 RelationsView.vue가 공유하는 그래프 노드/
// 엣지 모양 - vis-network에 그대로 넘기기 전 단계의 화면 전용 표현.

export interface RelationGraphNode {
  id: string;
  label: string;
  // 하위 관계가 있는데 아직 안 펼쳐졌으면 점선 테두리로 표시(펼칠
  // 여지가 있다는 신호).
  hasUnexpandedChildren?: boolean;
  // 검색/태그 필터에 실제로 매칭된 노드인지(강조 색상용).
  tagged?: boolean;
}

export interface RelationGraphEdge {
  id: string; // `${fromId}->${toId}`
  from: string; // DB CodeRelationEdge.fromId(자식/하위)
  to: string; // DB CodeRelationEdge.toId(부모/상위)
}
