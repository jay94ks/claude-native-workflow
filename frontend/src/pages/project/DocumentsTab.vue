<template>
  <DocTypeWorkspace
    :owner="owner"
    :project-id="projectId"
    type="doc"
    :kinds="['SP', 'RP', 'RM', 'QA', 'BT']"
    title="Documents"
    create-label="새 문서"
    :create-route="`/${owner}/${projectId}/documents/new`"
    :transitions-by-state="transitions"
    :code="code"
    :highlight-code="highlightCode"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import DocTypeWorkspace from "components/DocTypeWorkspace.vue";

defineProps<{ owner: string; projectId: string; code?: string }>();

// 설계자 요청(2026-09-21 후속) - 지금 보고 있는 문서는 이제 path segment
// (:code)로 식별된다(Browser History/새로고침 유지) - RecentQaFeed에서
// 넘어올 때 강조할 Q&A 항목만 여전히 쿼리(highlight)로 받는다.
const route = useRoute();
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
