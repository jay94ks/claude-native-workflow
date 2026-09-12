<script setup lang="ts">
const props = defineProps<{ page: number; totalPages: number }>();
const emit = defineEmits<{ "update:page": [page: number] }>();

function go(page: number) {
  if (page < 1 || page > props.totalPages || page === props.page) return;
  emit("update:page", page);
}
</script>

<template>
  <div v-if="totalPages > 1" class="pagination">
    <button type="button" :disabled="page <= 1" @click="go(page - 1)">이전</button>
    <span class="status">{{ page }} / {{ totalPages }}</span>
    <button type="button" :disabled="page >= totalPages" @click="go(page + 1)">다음</button>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 16px 0;
}
.pagination button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.pagination button:disabled {
  opacity: 0.5;
}
.status {
  font-size: 13px;
  color: var(--color-text-secondary);
}
</style>
