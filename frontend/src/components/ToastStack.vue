<script setup lang="ts">
import { useToastStore } from "../stores/toast";

const toast = useToastStore();
</script>

<template>
  <div class="toast-stack">
    <button v-for="t in toast.items" :key="t.id" type="button" class="toast" @click="toast.dismiss(t.id)">
      {{ t.text }}
    </button>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  z-index: 3000;
  max-width: calc(100vw - 32px);
}
.toast {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  text-align: left;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  max-width: 320px;
  animation: toast-in 0.15s ease-out;
}
.toast:hover {
  background: var(--color-surface-hover);
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
