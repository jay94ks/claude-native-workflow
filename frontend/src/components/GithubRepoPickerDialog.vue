<script setup lang="ts">
import { ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { nextDialogZIndex } from "../dialogZIndex";

interface GithubRepoSummary {
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}

const props = defineProps<{ open: boolean; credentialId: string }>();
const emit = defineEmits<{ close: []; select: [repo: GithubRepoSummary] }>();

const repos = ref<GithubRepoSummary[]>([]);
const loading = ref(false);
const error = ref("");
const page = ref(1);
const hasMore = ref(false);
const search = ref("");
const zIndex = ref(1000);

// GitHub API 자체가 텍스트 검색을 이 범위로 못 줘서(사용자 저장소
// 목록엔 검색 파라미터가 없음) 불러온 페이지들을 누적해 클라이언트
// 쪽에서 부분일치 필터만 한다 - EntityPickerDialog류보다 단순한 패턴.
async function loadPage(reset: boolean) {
  loading.value = true;
  error.value = "";
  try {
    const targetPage = reset ? 1 : page.value + 1;
    const result = await apiCall<{ items: GithubRepoSummary[]; hasMore: boolean }>(
      `/credentials/${props.credentialId}/github/repos?page=${targetPage}`,
    );
    repos.value = reset ? result.items : [...repos.value, ...result.items];
    page.value = targetPage;
    hasMore.value = result.hasMore;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "저장소 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    zIndex.value = nextDialogZIndex();
    repos.value = [];
    page.value = 1;
    hasMore.value = false;
    search.value = "";
    void loadPage(true);
  },
);

const filteredRepos = ref<GithubRepoSummary[]>([]);
watch([repos, search], () => {
  const q = search.value.trim().toLowerCase();
  filteredRepos.value = q ? repos.value.filter((r) => r.fullName.toLowerCase().includes(q)) : repos.value;
});
</script>

<template>
  <div v-if="open" class="overlay" :style="{ zIndex }" @click.self="emit('close')">
    <div class="dialog">
      <button class="close-btn" @click="emit('close')">닫기 ✕</button>
      <h2>GitHub 저장소 선택</h2>
      <input v-model="search" type="text" class="search-input" placeholder="저장소 이름으로 필터..." />
      <p v-if="error" class="error">{{ error }}</p>
      <ul class="list">
        <li v-for="r in filteredRepos" :key="r.fullName" class="repo-row" @click="emit('select', r)">
          <span class="name">{{ r.fullName }}</span>
          <span v-if="r.private" class="badge">private</span>
          <span class="branch">{{ r.defaultBranch }}</span>
        </li>
        <li v-if="!loading && filteredRepos.length === 0" class="muted">저장소가 없습니다.</li>
      </ul>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <button v-if="hasMore && !search" type="button" class="load-more" :disabled="loading" @click="loadPage(false)">
        더 불러오기
      </button>
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
  width: min(520px, 90vw);
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
h2 {
  font-size: 16px;
  margin: 0 0 12px;
  padding-right: 80px;
}
.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  margin-bottom: 10px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.repo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
  cursor: pointer;
}
.repo-row:hover {
  background: var(--color-surface-hover);
}
.repo-row:last-child {
  border-bottom: none;
}
.name {
  flex: 1;
  font-weight: 600;
}
.badge {
  font-size: 10px;
  color: var(--color-text-muted);
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 999px;
}
.branch {
  color: var(--color-text-faint);
  font-size: 11px;
}
.load-more {
  margin-top: 10px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 8px 0;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
