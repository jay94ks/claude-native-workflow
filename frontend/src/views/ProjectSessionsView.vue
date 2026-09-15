<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "../components/UserRef.vue";
import Pagination from "../components/Pagination.vue";

// "이 프로젝트에서 어떤 설계자의 어떤 세션이 활동 중인지" 전체 목록
// (설계자 지시, SP-976DD4ED) - 프로젝트 홈의 미리보기 "더보기"로
// 들어오는 화면. 계정 전체가 아니라 이 프로젝트에서 WorkClaim을
// 남긴 적 있는 세션만 대상.
const props = defineProps<{ id: string }>();

interface SessionItem {
  id: string;
  userId: string;
  name: string;
  clientKind: string;
  lastSeenAt: string;
  createdAt: string;
}
interface SessionPage {
  items: SessionItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 20;
const sessions = ref<SessionItem[]>([]);
const loading = ref(true);
const error = ref("");
const page = ref(1);
const totalPages = ref(1);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) });
    const result = await apiCall<SessionPage>(`/projects/${props.id}/sessions/page?${qs}`);
    sessions.value = result.items;
    totalPages.value = result.totalPages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "세션 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(page, load);
</script>

<template>
  <h2 class="heading">활동 세션</h2>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading" class="muted">불러오는 중...</p>
  <ul v-else class="list">
    <li v-for="s in sessions" :key="s.id">
      <UserRef :user-id="s.userId" />
      <span class="name">{{ s.name }}</span>
      <span class="kind">{{ s.clientKind }}</span>
      <span class="right muted">마지막 활동 {{ new Date(s.lastSeenAt).toLocaleString() }}</span>
    </li>
    <li v-if="sessions.length === 0" class="muted">이 프로젝트에서 활동한 세션이 없습니다.</li>
  </ul>
  <Pagination :page="page" :total-pages="totalPages" @update:page="page = $event" />
</template>

<style scoped>
.heading {
  font-size: 15px;
  margin: 0 0 12px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
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
.right {
  margin-left: auto;
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
