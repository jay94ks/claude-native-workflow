<script setup lang="ts">
import { computed } from "vue";
import { statusTone } from "../statusTone";

const props = defineProps<{ code: string; label?: string }>();
const tone = computed(() => statusTone(props.code));
</script>

<template>
  <span class="status-badge" :class="tone">{{ label ?? code }}</span>
</template>

<style scoped>
.status-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  line-height: 1.6;
}
.status-badge.neutral {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
}
.status-badge.info {
  background: var(--color-info-bg);
  color: var(--color-primary);
  border: 1px solid var(--color-info-border);
}
.status-badge.warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border: 1px solid var(--color-warning-border);
}
.status-badge.success {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.status-badge.purple {
  background: var(--color-purple-bg);
  color: var(--color-purple-text);
}
.status-badge.danger {
  background: var(--color-danger-bg);
  color: var(--color-danger);
  border: 1px solid var(--color-danger-border);
}
</style>
