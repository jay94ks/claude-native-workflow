<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { usePlanDialogStore } from "../stores/planDialog";
import { nextDialogZIndex } from "../dialogZIndex";
import MarkdownBody from "./MarkdownBody.vue";

interface PlanDetail {
  trackingCode: string;
  projectId: string;
  title: string;
  body: string;
  status: string;
}

const dialog = usePlanDialogStore();
const plan = ref<PlanDetail | null>(null);
const loading = ref(false);
const error = ref("");
const zIndex = ref(1000);

watch(
  () => dialog.open,
  (open) => {
    if (open) zIndex.value = nextDialogZIndex();
  },
);

watch(
  () => [dialog.open, dialog.trackingCode],
  async () => {
    if (!dialog.open || !dialog.trackingCode) return;
    plan.value = null;
    error.value = "";
    loading.value = true;
    try {
      plan.value = await apiCall<PlanDetail>(`/plans/${dialog.trackingCode}`);
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "계획을 불러오지 못했습니다";
    } finally {
      loading.value = false;
    }
  },
);
</script>

<template>
  <div v-if="dialog.open" class="overlay" :style="{ zIndex }" @click.self="dialog.close()">
    <div class="dialog">
      <button class="close-btn" @click="dialog.close()">닫기 ✕</button>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="plan">
        <div class="header">
          <code>{{ plan.trackingCode }}</code>
          <span class="status">{{ plan.status }}</span>
        </div>
        <h2>{{ plan.title }}</h2>
        <MarkdownBody :body="plan.body" />
        <router-link :to="`/projects/${plan.projectId}/plans/${plan.trackingCode}`" class="open-link" @click="dialog.close()">
          전체 화면에서 열기 →
        </router-link>
      </template>
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
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 10px;
  padding: 24px;
  width: min(720px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
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
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.header code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
.status {
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  padding: 2px 8px;
  border-radius: 999px;
}
h2 {
  font-size: 18px;
  margin: 0 0 14px;
}
.open-link {
  display: inline-block;
  margin-top: 16px;
  color: var(--color-primary);
  font-size: 13px;
  text-decoration: none;
}
.muted {
  color: var(--color-text-muted);
}
.error {
  color: var(--color-danger);
}
</style>
