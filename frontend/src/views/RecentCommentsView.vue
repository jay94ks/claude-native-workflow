<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "../components/UserRef.vue";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";

const props = defineProps<{ id: string }>();
const kanbanDialog = useKanbanCardDialogStore();

interface RecentComment {
  id: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  body: string;
  authorId: string;
  createdAt: string;
}

const comments = ref<RecentComment[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    comments.value = await apiCall<RecentComment[]>(`/projects/${props.id}/comments/recent?limit=100`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "코멘트 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function open(c: RecentComment) {
  if (c.targetType === "kanbanCard") kanbanDialog.show(c.targetKey);
}

onMounted(load);
</script>

<template>
  <h2 class="heading">최근 코멘트</h2>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="c in comments" :key="c.id">
      <router-link v-if="c.targetType === 'document'" :to="`/projects/${id}/documents/${c.targetKey}`">
        <code>{{ c.targetKey }}</code> {{ c.targetLabel }}
      </router-link>
      <router-link v-else-if="c.targetType === 'source'" :to="`/projects/${id}/source?path=${encodeURIComponent(c.targetKey)}`">
        📄 {{ c.targetLabel }}
      </router-link>
      <button v-else type="button" class="target-link" @click="open(c)">🗂 {{ c.targetLabel }}</button>
      <p class="body">{{ c.body }}</p>
      <div class="meta">
        <UserRef :user-id="c.authorId" />
        <span class="muted">{{ new Date(c.createdAt).toLocaleString() }}</span>
      </div>
    </li>
    <li v-if="comments.length === 0" class="muted">코멘트가 없습니다.</li>
  </ul>
</template>

<style scoped>
.heading {
  font-size: 15px;
  margin: 0 0 12px;
}
.list {
  list-style: none;
  padding: 0;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}
.list li:last-child {
  border-bottom: none;
}
.list code {
  font-size: 11px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
.target-link {
  background: none;
  border: none;
  color: #3454d1;
  font-size: 13px;
  padding: 0;
  cursor: pointer;
}
.body {
  margin: 6px 0;
  font-size: 13px;
  color: #333;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
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
