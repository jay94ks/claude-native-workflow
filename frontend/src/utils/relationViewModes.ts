// 관계도 캔버스가 지원하는 뷰 모드 목록 - RelationGraphCanvas.vue가
// props.viewMode로 이 배열에서 항목을 찾아 레이아웃/스타일을 정하고,
// RelationsView.vue의 서브탭도 이 배열을 순회해 버튼을 그린다. 새
// 뷰 모드를 추가할 땐 이 배열에 항목 하나만 더하면 된다(두 컴포넌트
// 모두 하드코딩된 분기 없음).

export interface RelationViewMode {
  id: string;
  label: string;
  layoutName: "fcose" | "dagre";
  layoutOptions: Record<string, unknown>;
  nodeShape: "ellipse" | "round-rectangle";
  colorByTag: boolean;
}

export const RELATION_VIEW_MODES: RelationViewMode[] = [
  {
    id: "network",
    label: "네트워크형",
    layoutName: "fcose",
    // randomize:false - 펼치기로 노드가 늘어날 때마다 전체를 다시
    // 흩뿌리지 않고 기존 노드는 그 자리 근처에 머물게 한다(줌/팬을
    // 건드리지 않는 것과 별개로, 레이아웃 자체도 안정적이어야
    // "펼쳤더니 그래프 전체가 요동친다"는 인상을 안 준다).
    layoutOptions: { randomize: false, animate: true, nodeRepulsion: 8000, idealEdgeLength: 90, quality: "default" },
    nodeShape: "ellipse",
    colorByTag: true,
  },
  {
    id: "hierarchical",
    label: "계층형",
    layoutName: "dagre",
    // rankDir "TB" + nodeSep/rankSep - 기존 vis-network 계층
    // 레이아웃(direction:"UD", nodeSpacing:140, levelSeparation:90)과
    // 같은 방향/밀도.
    layoutOptions: { rankDir: "TB", nodeSep: 60, rankSep: 90, animate: true },
    nodeShape: "round-rectangle",
    colorByTag: false,
  },
];

export const DEFAULT_VIEW_MODE_ID = "network";

export function getViewMode(id: string): RelationViewMode {
  return RELATION_VIEW_MODES.find((m) => m.id === id) ?? RELATION_VIEW_MODES[0];
}
