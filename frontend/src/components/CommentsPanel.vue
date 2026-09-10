<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";

const props = defineProps<{ projectId: string; trackingCode: string }>();

interface CommentItem {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  resolvedAt: string | null;
}

const comments = ref<CommentItem[]>([]);
const loading = ref(true);
const error = ref("");
const newComment = ref("");
const adding = ref(false);
const resolving = ref<Record<string, boolean>>({});

let disconnect: (() => void) | null = null;

const basePath = () => `/projects/${props.projectId}/documents/${props.trackingCode}/comments`;

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

async function resolve(c: CommentItem) {
  resolving.value = { ...resolving.value, [c.id]: true };
  error.value = "";
  try {
    await apiCall(`/projects/${props.projectId}/comments/${c.id}/resolve`, { method: "POST" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "해결 처리에 실패했습니다";
  } finally {
    resolving.value = { ...resolving.value, [c.id]: false };
  }
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.projectId, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "comment") load();
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section class="panel">
    <h2>코멘트</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="comments">
      <li v-for="c in comments" :key="c.id">
        <div class="c-row">
          <span class="author">{{ c.authorId }}</span>
          <span class="body">{{ c.body }}</span>
          <span class="at">{{ new Date(c.createdAt).toLocaleString() }}</span>
        </div>
        <div class="c-actions">
          <span v-if="c.resolvedAt" class="resolved">해결됨</span>
          <button v-else :disabled="resolving[c.id]" @click="resolve(c)">해결</button>
        </div>
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
  margin-bottom: 28px;
}
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.comments {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.comments li {
  padding: 8px 14px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.comments li:last-child {
  border-bottom: none;
}
.c-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
  flex: 1;
  min-width: 0;
}
.author {
  font-weight: 600;
  flex-shrink: 0;
}
.body {
  flex: 1;
}
.at {
  color: #999;
  font-size: 11px;
  flex-shrink: 0;
}
.c-actions {
  flex-shrink: 0;
}
.c-actions button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.c-actions button:hover {
  background: #eef0f6;
}
.resolved {
  font-size: 11px;
  color: #1f9254;
  background: #e3f6ec;
  padding: 4px 10px;
  border-radius: 999px;
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
