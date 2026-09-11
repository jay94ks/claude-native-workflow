<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { useAuthStore } from "../stores/auth";
import UserRef from "./UserRef.vue";
import TrackingCodeText from "./TrackingCodeText.vue";

const props = defineProps<{ projectId: string; trackingCode: string }>();
const auth = useAuthStore();

interface CommentItem {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

const comments = ref<CommentItem[]>([]);
const loading = ref(true);
const error = ref("");
const newComment = ref("");
const adding = ref(false);

const editingId = ref<string | null>(null);
const editDraft = ref("");
const saving = ref(false);
const busy = ref<Record<string, boolean>>({});

let disconnect: (() => void) | null = null;

const basePath = () => `/kanban/cards/${props.trackingCode}/comments`;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    comments.value = await apiCall<CommentItem[]>(basePath());
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "코멘트를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function add() {
  if (!newComment.value.trim()) return;
  adding.value = true;
  error.value = "";
  try {
    await apiCall(basePath(), { method: "POST", body: JSON.stringify({ body: newComment.value.trim() }) });
    newComment.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "코멘트 등록에 실패했습니다";
  } finally {
    adding.value = false;
  }
}

function startEdit(c: CommentItem) {
  editingId.value = c.id;
  editDraft.value = c.body;
}

async function saveEdit() {
  if (!editingId.value || !editDraft.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    await apiCall(`/kanban/card-comments/${editingId.value}`, { method: "PUT", body: JSON.stringify({ body: editDraft.value.trim() }) });
    editingId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function remove(c: CommentItem) {
  busy.value = { ...busy.value, [c.id]: true };
  error.value = "";
  try {
    await apiCall(`/kanban/card-comments/${c.id}`, { method: "DELETE" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  } finally {
    busy.value = { ...busy.value, [c.id]: false };
  }
}

const isMine = computed(() => (c: CommentItem) => c.authorId === auth.me?.id);

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.projectId, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "kanbanCardComment" && event.trackingCode === props.trackingCode) load();
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section class="panel">
    <h2>코멘트</h2>
    <p class="hint">설계자들끼리만 공유되는 채널 - AI(CLI/MCP)에는 노출되지 않는다.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="comments">
      <li v-for="c in comments" :key="c.id">
        <template v-if="editingId === c.id">
          <textarea v-model="editDraft" rows="2"></textarea>
          <div class="c-actions">
            <button :disabled="saving" @click="saveEdit">저장</button>
            <button type="button" class="cancel" @click="editingId = null">취소</button>
          </div>
        </template>
        <template v-else>
          <div class="c-row">
            <span class="author"><UserRef :user-id="c.authorId" /></span>
            <span class="body"><TrackingCodeText :text="c.body" /></span>
            <span class="at">{{ new Date(c.createdAt).toLocaleString() }}</span>
          </div>
          <div v-if="isMine(c)" class="c-actions">
            <button type="button" @click="startEdit(c)">수정</button>
            <button type="button" class="danger" :disabled="busy[c.id]" @click="remove(c)">삭제</button>
          </div>
        </template>
      </li>
      <li v-if="comments.length === 0" class="muted">아직 코멘트가 없습니다.</li>
    </ul>
    <form class="add-row" @submit.prevent="add">
      <input v-model="newComment" type="text" placeholder="코멘트 입력..." />
      <button type="submit" :disabled="adding">등록</button>
    </form>
  </section>
</template>

<style scoped>
.panel {
  margin-top: 20px;
}
h2 {
  font-size: 15px;
  margin: 0 0 4px;
}
.hint {
  font-size: 12px;
  color: #999;
  margin: 0 0 10px;
}
.comments {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: #f8f9fb;
  border-radius: 8px;
  overflow: hidden;
}
.comments li {
  padding: 8px 12px;
  border-bottom: 1px solid #eee;
}
.comments li:last-child {
  border-bottom: none;
}
.c-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  flex-wrap: wrap;
}
.author {
  font-weight: 600;
  flex-shrink: 0;
}
.body {
  flex: 1;
  min-width: 120px;
}
.at {
  color: #999;
  font-size: 11px;
  flex-shrink: 0;
}
.c-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.c-actions button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.c-actions button.cancel {
  color: #888;
}
.c-actions button.danger {
  color: #d1344b;
}
textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-family: inherit;
  resize: vertical;
}
.add-row {
  display: flex;
  gap: 8px;
}
.add-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.add-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.add-row button:disabled {
  opacity: 0.6;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
