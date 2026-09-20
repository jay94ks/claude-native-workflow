<template>
  <div class="row q-pa-md q-col-gutter-md">
    <div class="col-12 col-md-9">
      <DocTypeWorkspace
        :project-id="projectId"
        type="doc"
        :kinds="['SP', 'RP', 'RM', 'QA', 'BT']"
        title="Documents"
        create-label="새 문서"
        :create-route="`/projects/${projectId}/documents/new`"
        :transitions-by-state="transitions"
      />
    </div>
    <div class="col-12 col-md-3">
      <div class="gh-card q-pa-md">
        <ProjectAboutSidebar :project-id="projectId" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import DocTypeWorkspace from "components/DocTypeWorkspace.vue";
import ProjectAboutSidebar from "components/ProjectAboutSidebar.vue";

defineProps<{ projectId: string }>();

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
