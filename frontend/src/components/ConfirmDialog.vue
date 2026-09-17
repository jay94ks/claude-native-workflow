<script setup lang="ts">
// window.confirm() 대체용 공용 확인 다이얼로그(#frontend-confirm-dialog-unify,
// BL-57F8DF17 #70) - AppLayout.vue에 한 번 마운트해두고 어디서든
// `useConfirmDialogStore().confirm(message)`를 await하면 된다.
import { useConfirmDialogStore } from "../stores/confirmDialog";
import BaseModal from "./BaseModal.vue";

const dialog = useConfirmDialogStore();
</script>

<template>
  <BaseModal :open="dialog.open" :width="400" @close="dialog.resolve(false)">
    <p class="message">{{ dialog.message }}</p>
    <div class="actions">
      <button class="cancel-btn" @click="dialog.resolve(false)">취소</button>
      <button class="confirm-btn" @click="dialog.resolve(true)">확인</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.message {
  font-size: 14px;
  margin: 0 0 20px;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cancel-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.confirm-btn {
  background: var(--color-danger);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
</style>
