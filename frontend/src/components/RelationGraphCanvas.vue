<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { Network, type Options } from "vis-network";
import { DataSet } from "vis-data";
import "vis-network/styles/vis-network.min.css";
import type { RelationGraphNode, RelationGraphEdge } from "../utils/relationGraph";

// 다중 부모를 허용하는 순간 "하나의 전체 재귀 트리"로는 못 그린다
// (같은 노드가 여러 부모 밑에 중복되거나, 순환이 있으면 무한 재귀
// 위험) - 그래서 FolderNode.vue의 재귀 컴포넌트 패턴 대신 vis-network
// 그래프 라이브러리를 얇게 감싼다(설계자 지시). 노드/엣지 props를
// vis-data DataSet과 diff-sync해 전체 재렌더링 없이 점진적으로
// 갱신한다 - "펼치기"가 배열에 이어붙이면 그래프에 추가되고, 새
// 검색이 배열을 통째로 바꾸면 사라진 노드도 정리된다.

const props = defineProps<{
  nodes: RelationGraphNode[];
  edges: RelationGraphEdge[];
  selectedId?: string | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  expand: [id: string, direction: "parents" | "children"];
}>();

const container = ref<HTMLDivElement | null>(null);
let network: Network | null = null;
const nodesDs = new DataSet<Record<string, unknown>>();
const edgesDs = new DataSet<Record<string, unknown>>();

function readColor(varName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

function toVisNode(n: RelationGraphNode) {
  const primary = readColor("--color-primary", "#3454d1");
  const surface = readColor("--color-surface", "#fff");
  const border = readColor("--color-border", "#d8dae0");
  const text = readColor("--color-text", "#1a1a2e");
  return {
    id: n.id,
    label: n.label,
    shape: "box",
    margin: 8,
    color: {
      background: n.tagged ? primary : surface,
      border,
      highlight: { background: primary, border: text },
      hover: { background: primary, border: text },
    },
    font: { color: n.tagged ? "#fff" : text, size: 13 },
    borderWidth: n.hasUnexpandedChildren ? 2 : 1,
    shapeProperties: { borderDashes: n.hasUnexpandedChildren ? [4, 2] : false },
  };
}

function toVisEdge(e: RelationGraphEdge) {
  // DB 방향은 fromId(자식)→toId(부모)지만, 사람이 읽기엔 "위(부모)에서
  // 아래(자식)로 파생"이 더 직관적이라 화면에서만 화살표를 뒤집는다
  // (DB 스키마는 안 바꿈).
  return { id: e.id, from: e.to, to: e.from, arrows: "to", color: { color: readColor("--color-border", "#d8dae0") } };
}

function syncNodes(list: RelationGraphNode[]) {
  const ids = new Set(list.map((n) => n.id));
  const staleIds = nodesDs.getIds().filter((id) => !ids.has(String(id)));
  if (staleIds.length) nodesDs.remove(staleIds);
  if (list.length) nodesDs.update(list.map(toVisNode));
}

function syncEdges(list: RelationGraphEdge[]) {
  const ids = new Set(list.map((e) => e.id));
  const staleIds = edgesDs.getIds().filter((id) => !ids.has(String(id)));
  if (staleIds.length) edgesDs.remove(staleIds);
  if (list.length) edgesDs.update(list.map(toVisEdge));
}

onMounted(() => {
  syncNodes(props.nodes);
  syncEdges(props.edges);
  const options: Options = {
    layout: { hierarchical: { enabled: true, direction: "UD", sortMethod: "directed", levelSeparation: 90, nodeSpacing: 140 } },
    edges: { arrows: "to", smooth: { enabled: true, type: "cubicBezier", roundness: 0.4 } },
    // 계층 레이아웃이 안 맞는 순환 구간은 물리 시뮬레이션(hierarchical
    // repulsion)으로 자연스럽게 배치된다 - 순환을 강제로 막지 않는
    // 설계와 짝을 이루는 렌더링 전략.
    physics: { enabled: true, hierarchicalRepulsion: { nodeDistance: 130 }, stabilization: { iterations: 150 } },
    interaction: { hover: true, tooltipDelay: 200 },
  };
  network = new Network(container.value!, { nodes: nodesDs, edges: edgesDs }, options);
  network.on("selectNode", (params) => {
    if (params.nodes[0]) emit("select", String(params.nodes[0]));
  });
  network.on("doubleClick", (params) => {
    if (params.nodes[0]) emit("expand", String(params.nodes[0]), "children");
  });
  // 물리 안정화가 끝나야 노드들이 최종 위치에 자리잡는다 - 그 시점에
  // 한 번 더 맞춰야 안정화 도중 부른 fit()이 어중간한 배치를 프레이밍
  // 하는 문제가 없다.
  network.on("stabilizationIterationsDone", () => refit());
});

// 펼치기로 새 노드가 추가되면 화면 밖에 배치될 수 있다(계층 레이아웃이
// 안 맞는 순환 구간 등) - 매번 fit()으로 전체 그래프가 보이게 다시
// 맞춘다. stabilization 진행 중에 fit()을 부르면 자리를 못 잡은
// 상태를 프레이밍하므로, 물리 안정화가 끝난 뒤(stabilizationIterationsDone)
// 한 번 더 맞춘다.
function refit() {
  network?.fit({ animation: { duration: 300, easingFunction: "easeInOutQuad" } });
}
watch(
  () => props.nodes,
  (n) => {
    syncNodes(n);
    refit();
  },
  { deep: true },
);
watch(() => props.edges, syncEdges, { deep: true });
watch(
  () => props.selectedId,
  (id) => {
    if (network && id) network.selectNodes([id]);
  },
);

onUnmounted(() => {
  network?.destroy();
  network = null;
});
</script>

<template>
  <div ref="container" class="graph-canvas"></div>
</template>

<style scoped>
.graph-canvas {
  width: 100%;
  height: 100%;
  min-height: 480px;
  background: var(--color-surface);
  border-radius: 8px;
}
</style>
