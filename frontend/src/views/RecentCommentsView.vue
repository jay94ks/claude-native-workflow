<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "../components/UserRef.vue";

const props = defineProps<{ id: string }>();

interface RecentComment {
  id: string;
  trackingCode: string;
  documentTitle: string;
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

onMounted(load);
</script>

<template>
  <h2 class="heading">최근 코멘트</h2>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="c in comments" :key="c.id">
      <router-link :to="`/projects/${id}/documents/${c.trackingCode}`">
        <code>{{ c.trackingCode }}</code> {{ c.documentTitle }}
      </router-link>
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
