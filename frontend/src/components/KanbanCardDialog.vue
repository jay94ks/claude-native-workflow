<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";
import { useDocumentDialogStore } from "../stores/documentDialog";
import { nextDialogZIndex } from "../dialogZIndex";
import { roleSatisfies } from "../utils/projectContext";
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
interface KanbanColumnOption {
  id: string;
  name: string;
  hidden: boolean;
}

const dialog = useKanbanCardDialogStore();
const documentDialog = useDocumentDialogStore();
const card = ref<KanbanCardDetail | null>(null);
const columns = ref<KanbanColumnOption[]>([]);
const canMoveColumn = ref(false);
const loading = ref(false);
const error = ref("");
const moveError = ref("");
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
    card.value = null;
    columns.value = [];
    canMoveColumn.value = false;
    error.value = "";
    moveError.value = "";
    loading.value = true;
    try {
      card.value = await apiCall<KanbanCardDetail>(`/kanban/cards/${dialog.trackingCode}`);
      // 컬럼 드롭다운/이동 권한은 카드가 속한 프로젝트를 안 뒤에야 조회
      // 가능 - 이 다이얼로그는 AppLayout에 전역으로 떠 있어(ProjectShellView
      // 서브트리 밖) provide(PROJECT_MY_ROLE_KEY)를 inject로 받을 수 없다.
      const [cols, project] = await Promise.all([
        apiCall<KanbanColumnOption[]>(`/projects/${card.value.projectId}/kanban/columns`),
        apiCall<{ myRole: string | null }>(`/projects/${card.value.projectId}`),
      ]);
      columns.value = cols.filter((c) => !c.hidden);
      canMoveColumn.value = roleSatisfies(project.myRole, "editor");
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "카드를 불러오지 못했습니다";
    } finally {
      loading.value = false;
    }
  },
);

async function onColumnChange(newColumnId: string) {
  if (!card.value || newColumnId === card.value.columnId) return;
  moveError.value = "";
  try {
    await apiCall(`/kanban/cards/${card.value.trackingCode}/move`, {
      method: "PUT",
      body: JSON.stringify({ toColumnId: newColumnId }),
    });
    card.value = await apiCall<KanbanCardDetail>(`/kanban/cards/${card.value.trackingCode}`);
  } catch (err) {
    moveError.value = err instanceof ApiError ? err.message : "분류 변경에 실패했습니다";
  }
}
</script>

<template>
  <div v-if="dialog.open" class="overlay" :style="{ zIndex }" @click.self="dialog.close()">
    <div class="dialog">
      <button class="close-btn" @click="dialog.close()">닫기 ✕</button>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="card">
        <div class="header">
          <code>{{ card.trackingCode }}</code>
          <select
            v-if="canMoveColumn"
            class="column-select"
            :value="card.columnId"
            @change="onColumnChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="col in columns" :key="col.id" :value="col.id">{{ col.name }}</option>
          </select>
          <span v-else class="column">{{ card.columnName }}</span>
          <span v-if="card.origin === 'designer'" class="badge">필수</span>
        </div>
        <p v-if="moveError" class="error move-error">{{ moveError }}</p>
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

        <QAPanel :project-id="card.projectId" target-type="kanbanCard" :target-key="card.trackingCode" :in-dialog="true" />
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
  background: var(--color-surface);
  color: var(--color-text);
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
  gap: 8px;
  margin-bottom: 6px;
}
.header code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
.column {
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  padding: 2px 8px;
  border-radius: 999px;
}
.column-select {
  font-size: 12px;
  color: var(--color-text);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  padding: 2px 6px;
  border-radius: 999px;
}
.move-error {
  margin: 0 0 6px;
}
.badge {
  font-size: 11px;
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
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
  color: var(--color-text-muted);
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
  color: var(--color-text-secondary);
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
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-primary);
  cursor: pointer;
}
.ref-code:hover {
  background: var(--color-tcode-hover-bg);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
}
</style>
