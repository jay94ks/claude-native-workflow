<template>
  <div>
    <q-tabs v-model="innerTab" dense class="q-mx-md" align="left">
      <q-tab name="tracker" label="Trackers" />
      <q-tab name="test" label="Tests" />
      <q-tab name="qa" label="최근 Q&A 모아보기" />
    </q-tabs>
    <q-separator />
    <!-- tracker/test는 documentRules.ts대로 클로드(agent)가 전적으로 관리한다
         (architect는 discard/전이를 못 함) - WEB UI(=architect)는 읽기 전용. -->
    <DocTypeWorkspace v-if="innerTab === 'tracker'" :project-id="projectId" type="tracker" :kinds="['TR']" title="Trackers" read-only />
    <DocTypeWorkspace v-else-if="innerTab === 'test'" :project-id="projectId" type="test" :kinds="['TC']" title="Tests" read-only />
    <RecentQaFeed v-else :project-id="projectId" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import DocTypeWorkspace from "components/DocTypeWorkspace.vue";
import RecentQaFeed from "components/RecentQaFeed.vue";

defineProps<{ projectId: string }>();
const innerTab = ref<"tracker" | "test" | "qa">("tracker");
</script>
