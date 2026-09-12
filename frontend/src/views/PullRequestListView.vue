<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import Pagination from "../components/Pagination.vue";

const props = defineProps<{ id: string }>();

interface PullRequestSummary {
  index: number;
  title: string;
  state: string;
  authorUsername: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
  disposition: "merged" | "rejected" | null;
  createdAt: string;
}
interface PullRequestPage {
  items: PullRequestSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 20;
const state = ref<"open" | "closed" | "all">("all");
const pulls = ref<PullRequestSummary[]>([]);
const loading = ref(true);
const error = ref("");
const page = ref(1);
const totalPages = ref(1);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ state: state.value, page: String(page.value), pageSize: String(PAGE_SIZE) });
    const result = await apiCall<PullRequestPage>(`/projects/${props.id}/git/pulls/page?${qs}`);
    pulls.value = result.items;
    totalPages.value = result.totalPages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "PR 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function stateLabel(pr: PullRequestSummary): string {
  if (pr.disposition === "merged" || pr.merged) return "머지됨";
  if (pr.disposition === "rejected") return "거부됨";
  return pr.state === "open" ? "열림" : "닫힘";
}

watch(state, () => {
  page.value = 1;
  load();
});
watch(page, load);
load();
</script>

<template>
  <section class="panel">
    <div class="header">
      <h1>Pull Request 목록</h1>
      <router-link :to="`/projects/${id}/repo`" class="back-link">← 저장소 관리로</router-link>
    </div>
    <div class="tabs">
      <button type="button" :class="{ active: state === 'all' }" @click="state = 'all'">전체</button>
      <button type="button" :class="{ active: state === 'open' }" @click="state = 'open'">열림</button>
      <button type="button" :class="{ active: state === 'closed' }" @click="state = 'closed'">닫힘</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else>
      <ul class="pr-list">
        <li v-for="pr in pulls" :key="pr.index">
          <router-link class="pr-row" :to="`/projects/${id}/repo/pulls/${pr.index}`">
            <span class="pr-title">#{{ pr.index }} {{ pr.title }}</span>
            <span class="pr-state" :class="pr.disposition ?? (pr.merged ? 'merged' : pr.state)">{{ stateLabel(pr) }}</span>
          </router-link>
          <div class="pr-meta">
            {{ pr.authorUsername }} - {{ pr.headBranch }} → {{ pr.baseBranch }} -
            {{ new Date(pr.createdAt).toLocaleString() }}
          </div>
        </li>
        <li v-if="pulls.length === 0" class="muted">PR이 없습니다.</li>
      </ul>
      <Pagination :page="page" :total-pages="totalPages" @update:page="page = $event" />
    </template>
  </section>
</template>

<style scoped>
.panel {
  font-size: 13px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
h1 {
  font-size: 18px;
  margin: 0;
}
.back-link {
  color: var(--color-primary);
  font-size: 13px;
  text-decoration: none;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.tabs button {
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 12px;
}
.tabs button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.pr-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.pr-list li {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
}
.pr-list li:last-child {
  border-bottom: none;
}
.pr-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  text-decoration: none;
}
.pr-title {
  font-weight: 600;
  flex: 1;
}
.pr-state {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.pr-state.open {
  color: var(--color-success);
}
.pr-state.merged {
  color: var(--color-primary);
}
.pr-state.rejected {
  color: var(--color-danger);
}
.pr-meta {
  font-size: 11px;
  color: var(--color-text-faint);
  margin-top: 2px;
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
