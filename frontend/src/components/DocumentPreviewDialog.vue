<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useDocumentDialogStore } from "../stores/documentDialog";
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
  <div v-if="dialog.open" class="overlay" @click.self="dialog.close()">
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
  background: #fff;
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
  background: #fff;
  border: 1px solid #d8dae0;
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
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
.status {
  font-size: 12px;
  color: #555;
  background: #eef0f6;
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
  color: #3454d1;
  font-size: 13px;
  text-decoration: none;
}
.muted {
  color: #888;
}
.error {
  color: #d1344b;
}
</style>
