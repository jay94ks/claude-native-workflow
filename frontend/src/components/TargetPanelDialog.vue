<script setup lang="ts">
import { useTargetPanelDialogStore } from "../stores/targetPanelDialog";
import BaseModal from "./BaseModal.vue";
import QAPanel from "./QAPanel.vue";
import CommentsPanel from "./CommentsPanel.vue";
import OpinionsPanel from "./OpinionsPanel.vue";

const dialog = useTargetPanelDialogStore();
</script>

<template>
  <BaseModal :open="!!(dialog.open && dialog.projectId && dialog.targetKey)" @close="dialog.close()">
    <button class="close-btn" @click="dialog.close()">닫기 ✕</button>
    <QAPanel
      v-if="dialog.panel === 'qa'"
      :project-id="dialog.projectId!"
      :target-type="dialog.targetType"
      :target-key="dialog.targetKey!"
      :in-dialog="true"
    />
    <CommentsPanel
      v-else-if="dialog.panel === 'comments'"
      :project-id="dialog.projectId!"
      :target-type="dialog.targetType"
      :target-key="dialog.targetKey!"
    />
    <OpinionsPanel
      v-else
      :project-id="dialog.projectId!"
      :target-type="dialog.targetType"
      :target-key="dialog.targetKey!"
    />
  </BaseModal>
</template>

<style scoped>
.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
</style>
