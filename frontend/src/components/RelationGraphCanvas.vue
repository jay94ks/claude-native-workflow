<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import cytoscape, { type Core, type ElementDefinition, type StylesheetJsonBlock } from "cytoscape";
import type { RelationGraphNode, RelationGraphEdge } from "../utils/relationGraph";
import { colorForTag } from "../utils/relationGraph";
import { getViewMode, type RelationViewMode } from "../utils/relationViewModes";

// 다중 부모를 허용하는 순간 "하나의 전체 재귀 트리"로는 못 그린다
// (같은 노드가 여러 부모 밑에 중복되거나, 순환이 있으면 무한 재귀
// 위험) - 그래서 재귀 컴포넌트 패턴 대신 그래프 라이브러리를 얇게
// 감싼다(설계자 지시). Cytoscape.js + 레이아웃 플러그인(fcose/dagre)로
// 뷰 모드(네트워크형/계층형)를 갈아끼운다(#relations-graph-redesign -
// 이전 vis-network 구현은 노드를 펼칠 때마다 fit()을 강제로 호출해
// 사용자가 맞춰둔 줌/팬을 매번 초기화하는 버그가 있었다). 노드/엣지
// props는 diff-sync로 점진 갱신 - "펼치기"가 배열에 이어붙이면
// 그래프에 추가되고, 새 검색이 배열을 통째로 바꾸면 사라진 노드도
// 정리된다.
//
// fcose/dagre를 정적 import하면 둘 다 항상 이 컴포넌트 청크에 같이
// 실려 vis-network+vis-data보다도 커졌다(635KB vs 이전 554KB, 실측
// 확인) - 두 뷰 모드 중 실제로 쓰는 레이아웃만 그 순간에 동적
// import해서, 안 쓰는 쪽(기본값이 아닌 모드로 한 번도 안 바꾸면 그
// 레이아웃 라이브러리 자체를 아예 안 받는다) 청크를 분리한다.
const registeredLayouts = new Set<string>();
async function ensureLayoutRegistered(layoutName: "fcose" | "dagre") {
  if (registeredLayouts.has(layoutName)) return;
  const mod = layoutName === "fcose" ? await import("cytoscape-fcose") : await import("cytoscape-dagre");
  const ext = (mod as { default?: cytoscape.Ext }).default ?? (mod as unknown as cytoscape.Ext);
  cytoscape.use(ext);
  registeredLayouts.add(layoutName);
}

const props = defineProps<{
  nodes: RelationGraphNode[];
  edges: RelationGraphEdge[];
  selectedId?: string | null;
  viewMode: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  expand: [id: string, direction: "parents" | "children"];
}>();

const container = ref<HTMLDivElement | null>(null);
let cy: Core | null = null;

function readColor(varName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

function currentMode(): RelationViewMode {
  return getViewMode(props.viewMode);
}

function styleForMode(mode: RelationViewMode): StylesheetJsonBlock[] {
  const primary = readColor("--color-primary", "#3454d1");
  const surface = readColor("--color-surface", "#fff");
  const border = readColor("--color-border", "#d8dae0");
  const text = readColor("--color-text", "#1a1a2e");
  const isNetwork = mode.colorByTag;

  // Cytoscape 스타일 값은 문자열/숫자 또는 (element) => value 함수를
  // 받는다 - 태그/강조 상태에 따라 색이 달라져야 해서 함수 형태를
  // 쓴다. 공식 타입이 이 동적 함수 형태를 셀렉터별로 엄격하게 구분해
  // 요구해 배열 전체를 하나의 리터럴로 만들기 까다로우므로, 여기서만
  // any로 구성한 뒤 반환 타입으로 캐스팅한다.
  const style: unknown[] = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        shape: mode.nodeShape,
        "text-valign": "center",
        "text-halign": "center",
        "font-size": 11,
        "text-wrap": "wrap",
        "text-max-width": "90px",
        width: isNetwork ? 60 : "label",
        height: isNetwork ? 60 : "label",
        padding: isNetwork ? 0 : "10px",
        color: (ele: cytoscape.NodeSingular) => (isNetwork || ele.data("tagged") ? "#fff" : text),
        "background-color": (ele: cytoscape.NodeSingular) =>
          isNetwork ? colorForTag(ele.data("primaryTag")) : ele.data("tagged") ? primary : surface,
        "border-color": (ele: cytoscape.NodeSingular) => (ele.data("tagged") ? primary : border),
        "border-width": (ele: cytoscape.NodeSingular) =>
          ele.data("hasUnexpandedChildren") ? (ele.data("tagged") ? 4 : 3) : ele.data("tagged") ? 2 : 1,
        "border-style": (ele: cytoscape.NodeSingular) => (ele.data("hasUnexpandedChildren") ? "dashed" : "solid"),
      },
    },
    {
      // 부모/자식(DB 관계) - 기존 그대로 화살표 있는 실선.
      selector: "edge[kind = 'parentChild']",
      style: {
        "curve-style": isNetwork ? "bezier" : "taxi",
        "line-style": "solid",
        width: isNetwork ? 1.5 : 2,
        "line-color": border,
        "target-arrow-color": border,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
      },
    },
    {
      // 태그 공유(#relation-graph-tag-edges, 설계자 지시 - 처음엔
      // 실선으로 지시했다가 점선으로 정정됨) - 방향이 없는 관계라
      // 화살표는 안 그리고, 부모/자식의 실제 파생 관계(실선)와 시각적
      // 구분을 위해 점선. 색도 달리한다(진한 테두리색 대신 옅은 중립색).
      selector: "edge[kind = 'sharedTag']",
      style: {
        "curve-style": isNetwork ? "bezier" : "taxi",
        "line-style": "dashed",
        width: isNetwork ? 1 : 1.5,
        "line-color": "#9aa1ac",
        "target-arrow-shape": "none",
        opacity: 0.55,
      },
    },
    {
      selector: "node:selected",
      style: { "border-color": primary, "border-width": 4 },
    },
  ];
  return style as StylesheetJsonBlock[];
}

function toCyNode(n: RelationGraphNode): ElementDefinition {
  return {
    group: "nodes",
    data: {
      id: n.id,
      label: n.label,
      tagged: !!n.tagged,
      hasUnexpandedChildren: !!n.hasUnexpandedChildren,
      primaryTag: n.primaryTag ?? null,
    },
  };
}

function toCyEdge(e: RelationGraphEdge): ElementDefinition {
  const kind = e.kind ?? "parentChild";
  if (kind === "sharedTag") {
    // 방향이 없는 관계 - source/target 순서는 의미 없다(화살표 자체를
    // 안 그림, styleForMode의 edge[kind='sharedTag'] 참고).
    return { group: "edges", data: { id: e.id, source: e.from, target: e.to, kind } };
  }
  // DB 방향은 fromId(자식)→toId(부모)지만, 사람이 읽기엔 "위(부모)에서
  // 아래(자식)로 파생"이 더 직관적이라 화면에서만 화살표를 뒤집는다
  // (DB 스키마는 안 바꿈) - vis-network 시절 {from: e.to, to: e.from}과
  // 같은 규칙, Cytoscape에서는 source/target으로 표현.
  return { group: "edges", data: { id: e.id, source: e.to, target: e.from, kind } };
}

function syncNodes(list: RelationGraphNode[]) {
  if (!cy) return;
  const ids = new Set(list.map((n) => n.id));
  cy.nodes().forEach((ele) => {
    if (!ids.has(ele.id())) ele.remove();
  });
  for (const n of list) {
    const found = cy.getElementById(n.id);
    if (found.nonempty()) found.data(toCyNode(n).data);
    else cy.add(toCyNode(n));
  }
}

function syncEdges(list: RelationGraphEdge[]) {
  if (!cy) return;
  const ids = new Set(list.map((e) => e.id));
  cy.edges().forEach((ele) => {
    if (!ids.has(ele.id())) ele.remove();
  });
  for (const e of list) {
    const found = cy.getElementById(e.id);
    if (found.nonempty()) found.data(toCyEdge(e).data);
    else cy.add(toCyEdge(e));
  }
}

// fit()을 부르는 곳은 딱 3군데(초기 1회/화면맞추기 버튼/뷰 모드 전환) -
// 노드가 늘어날 때(펼치기)는 fit:false로만 재배치해서 사용자가 맞춰둔
// 줌/팬을 절대 건드리지 않는다(vis-network 시절 매 펼치기마다 fit()을
// 강제 호출해 줌이 초기화되던 버그의 실제 수정 지점).
async function runLayout(opts: { fit: boolean }) {
  if (!cy) return;
  const mode = currentMode();
  await ensureLayoutRegistered(mode.layoutName);
  if (!cy) return; // await 도중 언마운트됐을 수 있음
  // fcose의 randomize:false는 "이미 자리잡은 노드들 근처만 다듬는다"는
  // 뜻이라, 처음 붙는 새 노드들이 전부 좌표 없음(=원점)에서 시작하면
  // 힘 계산의 거리항이 0이 돼 서로 밀어내는 방향이 무작위/극단으로
  // 튀는 문제가 있다(신규 프로젝트에서 루트 노드 2개가 화면 구석에
  // 겹쳐 보이던 버그의 원인 - 격리 스택 실측으로 확인). 완전히 새로
  // 배치하는 시점(fit:true - 최초 로드/화면맞추기/뷰 모드 전환)에는
  // randomize:true로 강제해 처음부터 고르게 흩뿌리고, 펼치기로 몇 개만
  // 추가되는 점진 갱신(fit:false)에서만 기존 노드 위치를 지키도록
  // randomize:false를 쓴다.
  // 새로 전체 배치하는 경우(fit:true)는 노드 이동 애니메이션을 끈다 -
  // 켜두면 "layoutstop"이 최종 좌표가 아니라 애니메이션 도중(거의 원점
  // 근처) 시점에 먼저 발생해, 그 순간 부르는 fit()이 잘못된(너무 작은)
  // 바운딩 박스로 화면을 맞춰버리는 문제가 있었다(격리 스택 실측 -
  // 수동 "화면에 맞추기" 버튼은 한참 뒤에 눌러서 문제 없이 보였다).
  // 펼치기 같은 점진 갱신(fit:false)은 화면을 안 건드리니 애니메이션을
  // 켜둬도 안전하다.
  const layout = cy.layout({
    name: mode.layoutName,
    fit: false,
    animate: !opts.fit,
    ...mode.layoutOptions,
    ...(mode.layoutName === "fcose" ? { randomize: opts.fit } : {}),
  } as cytoscape.LayoutOptions);
  if (opts.fit) {
    layout.one("layoutstop", () => cy?.fit(undefined, 30));
  }
  layout.run();
}

function zoomBy(factor: number) {
  if (!cy) return;
  const level = Math.min(Math.max(cy.zoom() * factor, cy.minZoom()), cy.maxZoom());
  cy.zoom({ level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
}
function zoomIn() {
  zoomBy(1.25);
}
function zoomOut() {
  zoomBy(0.8);
}
function resetZoom() {
  if (!cy) return;
  cy.zoom({ level: 1, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
}
function fitToScreen() {
  if (!cy) return;
  cy.animate({ fit: { eles: cy.elements(), padding: 30 } }, { duration: 300 });
}

// nodes prop이 바뀔 때 fit()을 걸지 말지는 "펼치기로 몇 개 이어붙은
// 것"과 "검색/필터/전체 보기/초기화로 그래프 자체가 사실상 새로 바뀐
// 것"을 구분해서 정한다 - 이전에 있던 노드 id가 하나라도 사라졌으면
// (또는 이전엔 아무것도 없었으면) 순수 append가 아니므로 새로 화면에
// 맞춘다. 펼치기는 항상 append만 하므로(mergeIntoCache, clearCache
// 없이) 자동으로 fit:false로 분류된다. 이 비교가 "그래프가 처음으로
// 실제 내용을 받는 순간"도 자연히 잡아낸다 - RelationsView.vue는
// onMounted에서 비동기 search()로 데이터를 채우는데, 이 캔버스는 그
// 부모 onMounted보다 먼저 마운트되므로(Vue의 마운트 순서) 마운트
// 시점엔 props.nodes가 아직 빈 배열이고, 진짜 첫 데이터는 이 watch를
// 통해 뒤늦게 들어온다(빈 집합 → 비어있지 않은 집합은 항상 "펼치기가
// 아님"으로 분류됨) - 이 구분이 없으면 첫 로드가 화면 구석에 아주
// 작게 걸쳐 보이는 채로 방치된다(격리 스택 실측으로 확인된 버그).
let previousNodeIds = new Set<string>();

onMounted(() => {
  cy = cytoscape({
    container: container.value!,
    elements: [...props.nodes.map(toCyNode), ...props.edges.map(toCyEdge)],
    style: styleForMode(currentMode()),
    minZoom: 0.1,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    userZoomingEnabled: true,
    userPanningEnabled: true,
  });
  cy.on("tap", "node", (evt) => emit("select", evt.target.id()));
  cy.on("dbltap", "node", (evt) => emit("expand", evt.target.id(), "children"));
  previousNodeIds = new Set(props.nodes.map((n) => n.id));
  runLayout({ fit: previousNodeIds.size > 0 });
});

watch(
  () => props.nodes,
  (n) => {
    syncNodes(n);
    const newIds = new Set(n.map((x) => x.id));
    const isPureAppend = previousNodeIds.size > 0 && [...previousNodeIds].every((id) => newIds.has(id));
    previousNodeIds = newIds;
    runLayout({ fit: !isPureAppend });
  },
  { deep: true },
);
watch(() => props.edges, syncEdges, { deep: true });
watch(
  () => props.selectedId,
  (id) => {
    if (!cy) return;
    cy.elements().unselect();
    if (id) cy.getElementById(id).select();
  },
);
watch(
  () => props.viewMode,
  () => {
    if (!cy) return;
    cy.style(styleForMode(currentMode()));
    runLayout({ fit: true });
  },
);

onUnmounted(() => {
  cy?.destroy();
  cy = null;
});
</script>

<template>
  <div class="graph-canvas-wrap">
    <div ref="container" class="graph-canvas"></div>
    <div class="zoom-controls">
      <button type="button" title="확대" @click="zoomIn">+</button>
      <button type="button" title="축소" @click="zoomOut">−</button>
      <button type="button" title="100%" @click="resetZoom">100%</button>
      <button type="button" title="화면에 맞추기" @click="fitToScreen">⤢</button>
    </div>
  </div>
</template>

<style scoped>
.graph-canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.graph-canvas {
  width: 100%;
  height: 100%;
  min-height: 480px;
  background: var(--color-surface);
  border-radius: 8px;
}
.zoom-controls {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 10;
}
.zoom-controls button {
  width: 32px;
  height: 32px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.zoom-controls button:hover {
  background: var(--color-surface-hover);
}
</style>
