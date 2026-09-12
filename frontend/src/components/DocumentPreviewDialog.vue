<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useDocumentDialogStore } from "../stores/documentDialog";
import { nextDialogZIndex } from "../dialogZIndex";
import MarkdownBody from "./MarkdownBody.vue";

interface DocumentDetail {
  trackingCode: string;
  projectId: string;
  title: string;
  body: string;
  statusCode: string;
}

const dialog = useDocumentDialogStore();
const doc = ref<DocumentDetail | null>(null);
const loading = ref(false);
const error = ref("");
const zIndex = ref(1000);

// 다른 다이얼로그(예: 칸반 카드) 안에서 이 다이얼로그를 열 수도 있고
// 반대 방향도 가능해(양방향 참조) 열릴 때마다 공유 카운터에서 새
// z-index를 받아야 항상 마지막에 연 게 위로 온다.
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
    doc.value = null;
    error.value = "";
    loading.value = true;
    try {
      doc.value = await apiCall<DocumentDetail>(`/documents/${dialog.trackingCode}`);
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "문서를 불러오지 못했습니다";
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
      <template v-else-if="doc">
        <div class="header">
          <code>{{ doc.trackingCode }}</code>
          <span class="status">{{ doc.statusCode }}</span>
        </div>
        <h2>{{ doc.title }}</h2>
        <MarkdownBody :body="doc.body" />
        <router-link :to="`/projects/${doc.projectId}/documents/${doc.trackingCode}`" class="open-link" @click="dialog.close()">
          전체 화면에서 열기 →
        </router-link>
        <router-link :to="`/projects/${doc.projectId}/relations?trackingCode=${doc.trackingCode}`" class="open-link" @click="dialog.close()">
          관계도에서 보기 →
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
