<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

// 같은 계정으로 여러 Claude 세션을 동시에 띄울 때 서로를 구분하기
// 위한 목록(SP-976DD4ED, #multi-session-workclaim) - CLI/MCP가
// 자동으로 붙이는 X-Session-Id 헤더로 서버가 하트비트를 갱신해두므로,
// 이 화면은 조회/이름 변경만 한다.
interface SessionDetail {
  id: string;
  name: string;
  clientKind: string;
  lastSeenAt: string;
  createdAt: string;
}

const sessions = ref<SessionDetail[]>([]);
const loading = ref(true);
const error = ref("");
const editingId = ref<string | null>(null);
const editDraft = ref("");
const saving = ref(false);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    sessions.value = await apiCall<SessionDetail[]>("/sessions");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "세션 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function startRename(s: SessionDetail) {
  editingId.value = s.id;
  editDraft.value = s.name;
  error.value = "";
}

async function saveRename() {
  if (!editingId.value || !editDraft.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    await apiCall(`/sessions/${editingId.value}/name`, { method: "PUT", body: JSON.stringify({ name: editDraft.value.trim() }) });
    editingId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "이름 변경에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="card">
    <h2>내 세션</h2>
    <p class="hint">같은 계정으로 동시에 떠 있는 CLI/MCP 세션들 - 마지막 활동 시각으로 지금 살아있는지 가늠할 수 있다.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="list">
      <li v-for="s in sessions" :key="s.id">
        <template v-if="editingId === s.id">
          <input v-model="editDraft" type="text" class="edit-input" @keyup.enter="saveRename" />
          <button class="manage-btn" :disabled="saving" @click="saveRename">저장</button>
          <button class="manage-btn" @click="editingId = null">취소</button>
        </template>
        <template v-else>
          <span class="name">{{ s.name }}</span>
          <span class="kind">{{ s.clientKind }}</span>
          <span class="at">마지막 활동 {{ new Date(s.lastSeenAt).toLocaleString() }}</span>
          <button class="manage-btn" @click="startRename(s)">이름 변경</button>
        </template>
      </li>
      <li v-if="sessions.length === 0" class="muted">아직 활동한 세션이 없습니다.</li>
    </ul>
  </section>
</template>

<style scoped>
.card {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 14px;
  margin: 0 0 12px;
  color: var(--color-text-secondary);
}
.hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 12px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.name {
  font-weight: 600;
}
.kind {
  background: var(--color-surface-hover);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-text-muted);
}
.at {
  margin-left: auto;
  color: var(--color-text-faint);
  font-size: 11px;
  white-space: nowrap;
}
.edit-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
}
.manage-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  flex-shrink: 0;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
