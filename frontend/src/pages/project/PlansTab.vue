<template>
  <DocTypeWorkspace
    :owner="owner"
    :project-id="projectId"
    type="plan"
    :kinds="['PL']"
    :states="['added', 'read', 'done', 'discard']"
    title="Plans"
    create-label="새 계획"
    :create-route="`/${owner}/${projectId}/plans/new`"
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

const route = useRoute();
const highlightCode = computed(() => (typeof route.query.highlight === "string" ? route.query.highlight : undefined));

// plan의 상태 전이(documentRules.ts "plan" 분기) - added->read->done/discard,
// 전부 architect만 할 수 있어 이 WEB UI 채널과 정확히 맞는다.
const transitions: Record<string, { to: string; label: string; color?: string }[]> = {
  added: [
    { to: "read", label: "확인함" },
    { to: "discard", label: "폐기", color: "negative" },
  ],
  read: [
    { to: "done", label: "완료" },
    { to: "discard", label: "폐기", color: "negative" },
  ],
};
</script>
