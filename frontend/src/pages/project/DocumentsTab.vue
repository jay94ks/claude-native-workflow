<template>
  <DocTypeWorkspace
    :project-id="projectId"
    type="doc"
    :kinds="['SP', 'RP', 'RM', 'QA', 'BT']"
    title="Documents"
    create-label="새 문서"
    :create-route="`/projects/${projectId}/documents/new`"
    :transitions-by-state="transitions"
    :open-code="openCode"
    :highlight-code="highlightCode"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import DocTypeWorkspace from "components/DocTypeWorkspace.vue";

defineProps<{ projectId: string }>();

// 설계자 요청(2026-09-21) - RecentQaFeed에서 Q&A 항목을 누르면 그게 달린
// 문서로 와서 자동 선택 + 스크롤돼야 한다(쿼리스트링으로 전달받음).
const route = useRoute();
const openCode = computed(() => (typeof route.query.open === "string" ? route.query.open : undefined));
const highlightCode = computed(() => (typeof route.query.highlight === "string" ? route.query.highlight : undefined));

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
