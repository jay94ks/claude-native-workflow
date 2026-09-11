<script setup lang="ts">
import { useTargetPanelDialogStore } from "../stores/targetPanelDialog";
import QAPanel from "./QAPanel.vue";
import CommentsPanel from "./CommentsPanel.vue";

const dialog = useTargetPanelDialogStore();
</script>

<template>
  <div v-if="dialog.open && dialog.projectId && dialog.targetKey" class="overlay" @click.self="dialog.close()">
    <div class="dialog">
      <button class="close-btn" @click="dialog.close()">닫기 ✕</button>
      <QAPanel
        v-if="dialog.panel === 'qa'"
        :project-id="dialog.projectId"
        :target-type="dialog.targetType"
        :target-key="dialog.targetKey"
        :in-dialog="true"
      />
      <CommentsPanel
        v-else
        :project-id="dialog.projectId"
        :target-type="dialog.targetType"
        :target-key="dialog.targetKey"
      />
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog {
  background: #fff;
  border-radius: 10px;
  padding: 24px;
  width: min(640px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
</style>
