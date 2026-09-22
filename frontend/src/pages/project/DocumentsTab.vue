<template>
  <DocTypeWorkspace
    :owner="owner"
    :project-id="projectId"
    type="doc"
    :kinds="kinds"
    :kind-labels="kindLabels"
    :states="['draft', 'review', 'active', 'done', 'discard']"
    title="Documents"
    create-label="새 문서"
    :create-route="`/${owner}/${projectId}/documents/new`"
    :transitions-by-state="transitions"
    :code="code"
    :highlight-code="highlightCode"
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "stores/auth";
import DocTypeWorkspace from "components/DocTypeWorkspace.vue";
import * as api from "src/api/client";

const props = defineProps<{ owner: string; projectId: string; code?: string }>();
const auth = useAuthStore();

// 설계자 요청(2026-09-21 후속) - 지금 보고 있는 문서는 이제 path segment
// (:code)로 식별된다(Browser History/새로고침 유지) - RecentQaFeed에서
// 넘어올 때 강조할 Q&A 항목만 여전히 쿼리(highlight)로 받는다.
const route = useRoute();
const highlightCode = computed(() => (typeof route.query.highlight === "string" ? route.query.highlight : undefined));

// 설계자 요청(2026-09-22 후속) - "문서 분류도 추가/수정이 가능해야 한다" -
// 더 이상 SP/RP/RM/QA/BT 다섯 개를 여기 하드코딩하지 않고, 이 프로젝트가
// docKind.list로 관리하는 분류(기본 5개 + 커스텀)를 그대로 받아온다.
// 설계자 지적(2026-09-22 후속, "더 최적화해") - 예전엔 이 fetch가 끝날
// 때까지 DocTypeWorkspace 자체를 마운트 안 해서(v-if) 페이지 전체가
// 그 왕복 시간만큼 늦게 떴다. DocTypeWorkspace가 이제 kinds를 나중에
// 받아도(watch로) URL의 ?kind= 값을 스스로 재검증하므로, 여기서는
// 그냥 빈 배열로 즉시 렌더링을 시작하고 kinds/kindLabels가 로드되는
// 대로 props로 흘려보내면 된다 - 블로킹 게이트 자체를 없앴다.
const kinds = ref<string[]>([]);
const kindLabels = ref<Record<string, string>>({});

async function loadKinds() {
  const result = await api.listDocKinds(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) {
    const items = (result.data as { items: { code: string; label: string }[] }).items;
    kinds.value = items.map((i) => i.code);
    kindLabels.value = Object.fromEntries(items.map((i) => [i.code, i.label]));
  }
}
onMounted(loadKinds);

// doc의 상태 전이(backend/src/core/documentRules.ts checkTransition의
// "doc" 분기와 맞춘 것 - 실제 허용 여부는 항상 서버가 최종 판단한다,
// 여기 버튼은 UX를 위한 힌트일 뿐).
const transitions = {
  draft: [{ to: "review", label: "리뷰 요청" }],
  review: [{ to: "active", label: "승인(활성화)" }],
  active: [{ to: "done", label: "완료" }],
} as Record<string, { to: string; label: string; color?: string }[]>;
for (const state of ["draft", "review", "active"]) {
  transitions[state] = [...transitions[state], { to: "discard", label: "폐기", color: "negative" }];
}
</script>
