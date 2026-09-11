<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";
import { useDocumentDialogStore } from "../stores/documentDialog";
import UserRef from "./UserRef.vue";
import CommentsPanel from "./CommentsPanel.vue";
import QAPanel from "./QAPanel.vue";

interface KanbanCardDetail {
  trackingCode: string;
  projectId: string;
  columnId: string;
  columnName: string;
  title: string;
  body: string | null;
  origin: string;
  createdBy: string;
  createdAt: string;
  docRefs: string[];
}

const dialog = useKanbanCardDialogStore();
const documentDialog = useDocumentDialogStore();
const card = ref<KanbanCardDetail | null>(null);
const loading = ref(false);
const error = ref("");

watch(
  () => [dialog.open, dialog.trackingCode],
  async () => {
    if (!dialog.open || !dialog.trackingCode) return;
    card.value = null;
    error.value = "";
    loading.value = true;
    try {
      card.value = await apiCall<KanbanCardDetail>(`/kanban/cards/${dialog.trackingCode}`);
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "카드를 불러오지 못했습니다";
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
      <template v-else-if="card">
        <div class="header">
          <code>{{ card.trackingCode }}</code>
          <span class="column">{{ card.columnName }}</span>
          <span v-if="card.origin === 'designer'" class="badge">필수</span>
        </div>
        <h2>{{ card.title }}</h2>
        <div class="meta">작성 <UserRef :user-id="card.createdBy" /> · {{ new Date(card.createdAt).toLocaleString() }}</div>

        <section v-if="card.body" class="section">
          <h3>{{ card.origin === "designer" ? "받은 지시" : "설명" }}</h3>
          <p class="body-text">{{ card.body }}</p>
        </section>

        <section class="section">
          <h3>근거 문서</h3>
          <ul v-if="card.docRefs.length > 0" class="ref-list">
            <li v-for="ref in card.docRefs" :key="ref">
              <code class="ref-code" @click="documentDialog.show(ref)">{{ ref }}</code>
            </li>
          </ul>
          <p v-else class="muted">연결된 근거 문서가 없습니다.</p>
        </section>

        <QAPanel :project-id="card.projectId" target-type="kanbanCard" :target-key="card.trackingCode" />
        <CommentsPanel :project-id="card.projectId" target-type="kanbanCard" :target-key="card.trackingCode" />
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
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.header code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
.column {
  font-size: 12px;
  color: #555;
  background: #eef0f6;
  padding: 2px 8px;
  border-radius: 999px;
}
.badge {
  font-size: 11px;
  color: #a3410c;
  background: #fdecdc;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}
h2 {
  font-size: 18px;
  margin: 0 0 6px;
}
.meta {
  font-size: 12px;
  color: #888;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
}
.section {
  margin-bottom: 16px;
}
.section h3 {
  font-size: 13px;
  color: #555;
  margin: 0 0 6px;
}
.body-text {
  font-size: 13px;
  white-space: pre-wrap;
  margin: 0;
}
.ref-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ref-code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  color: #3454d1;
  cursor: pointer;
}
.ref-code:hover {
  background: #e4e9fb;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
}
</style>
