<template>
  <div>
    <q-tabs v-model="innerTab" dense class="q-mx-md" align="left">
      <q-tab name="tracker" label="Trackers" />
      <q-tab name="test" label="Tests" />
      <q-tab name="qa" label="RECENT Q&A" />
    </q-tabs>
    <q-separator />
    <!-- tracker/test는 documentRules.ts대로 클로드(agent)가 전적으로 관리한다
         (architect는 discard/전이를 못 함) - WEB UI(=architect)는 읽기 전용. -->
    <DocTypeWorkspace
      v-if="innerTab === 'tracker'"
      :owner="owner"
      :project-id="projectId"
      type="tracker"
      :kinds="['TR']"
      title="Trackers"
      read-only
      :open-code="innerTab === 'tracker' ? openCode : undefined"
      :highlight-code="innerTab === 'tracker' ? highlightCode : undefined"
    />
    <DocTypeWorkspace
      v-else-if="innerTab === 'test'"
      :owner="owner"
      :project-id="projectId"
      type="test"
      :kinds="['TC']"
      title="Tests"
      read-only
      :open-code="innerTab === 'test' ? openCode : undefined"
      :highlight-code="innerTab === 'test' ? highlightCode : undefined"
    />
    <RecentQaFeed v-else :owner="owner" :project-id="projectId" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import DocTypeWorkspace from "components/DocTypeWorkspace.vue";
import RecentQaFeed from "components/RecentQaFeed.vue";

defineProps<{ owner: string; projectId: string }>();

// 설계자 요청(2026-09-21) - RecentQaFeed에서 항목을 누르면 그 Q&A가 달린
// 문서(여기서는 tracker/test)로 와서 그 문서를 자동 선택 + 스크롤해야
// 한다 - 쿼리스트링(inner=tracker|test&open=<code>&highlight=<code>)으로
// 어느 내부 탭을 열고 뭘 선택할지 전달받는다.
const route = useRoute();
const innerTab = ref<"tracker" | "test" | "qa">("tracker");
const openCode = ref<string | undefined>(undefined);
const highlightCode = ref<string | undefined>(undefined);

onMounted(() => {
  const inner = route.query.inner;
  if (inner === "tracker" || inner === "test" || inner === "qa") innerTab.value = inner;
  const open = route.query.open;
  if (typeof open === "string") openCode.value = open;
  const highlight = route.query.highlight;
  if (typeof highlight === "string") highlightCode.value = highlight;
});
</script>
