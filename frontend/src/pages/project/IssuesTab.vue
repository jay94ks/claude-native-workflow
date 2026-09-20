<template>
  <DocTypeWorkspace
    :project-id="projectId"
    type="issue"
    :kinds="['IS']"
    title="Issues"
    create-label="새 이슈"
    :create-route="`/projects/${projectId}/issues/new`"
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

const route = useRoute();
const openCode = computed(() => (typeof route.query.open === "string" ? route.query.open : undefined));
const highlightCode = computed(() => (typeof route.query.highlight === "string" ? route.query.highlight : undefined));

// design-notes.md "UI 설계"(설계자 요청, 2026-09-20) - Issues는 Plans와
// 완전히 별개인 새 개념(documentRules.ts의 issue 타입: open/closed만).
// GitHub Issues처럼 어느 채널이든 열고 닫을 수 있다.
const transitions: Record<string, { to: string; label: string; color?: string }[]> = {
  open: [{ to: "closed", label: "Close issue", color: "negative" }],
  closed: [{ to: "open", label: "Reopen issue", color: "positive" }],
};
</script>
