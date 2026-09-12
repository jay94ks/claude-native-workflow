<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string }>();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canCreatePr = computed(() => roleSatisfies(myRole.value, "editor"));
const canMerge = computed(() => roleSatisfies(myRole.value, "owner"));

interface GitRepo {
  provider: string;
  repoUrl: string;
}
interface BranchSummary {
  name: string;
  commitSha: string;
  lastCommitAt: string | null;
}
interface PullRequestSummary {
  index: number;
  title: string;
  body: string;
  state: string;
  authorUsername: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
  createdAt: string;
}

const hasRepo = ref<boolean | null>(null);
const loading = ref(true);
const error = ref("");

const branches = ref<BranchSummary[]>([]);
const pulls = ref<PullRequestSummary[]>([]);

async function checkRepo() {
  try {
    await apiCall<GitRepo>(`/projects/${props.id}/git/repo`);
    hasRepo.value = true;
  } catch {
    hasRepo.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [branches.value, pulls.value] = await Promise.all([
      apiCall<BranchSummary[]>(`/projects/${props.id}/git/branches`),
      apiCall<PullRequestSummary[]>(`/projects/${props.id}/git/pulls?state=all`),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "저장소 정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- PR 생성
const showCreateForm = ref(false);
const newTitle = ref("");
const newHead = ref("");
const newBase = ref("");
const newBody = ref("");
const creating = ref(false);
const createError = ref("");

async function createPull() {
  if (!newTitle.value.trim() || !newHead.value || !newBase.value) return;
  creating.value = true;
  createError.value = "";
  try {
    await apiCall(`/projects/${props.id}/git/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: newTitle.value.trim(), head: newHead.value, base: newBase.value, body: newBody.value }),
    });
    newTitle.value = "";
    newHead.value = "";
    newBase.value = "";
    newBody.value = "";
    showCreateForm.value = false;
    await load();
  } catch (err) {
    createError.value = err instanceof ApiError ? err.message : "PR 생성에 실패했습니다";
  } finally {
    creating.value = false;
  }
}

// ---------------------------------------------------------------- PR 머지(owner 전용, 서버도 403으로 이중 방어)
const mergingIndex = ref<number | null>(null);
const mergeError = ref("");

async function mergePull(pr: PullRequestSummary) {
  if (!window.confirm(`PR #${pr.index} "${pr.title}"을(를) ${pr.baseBranch}에 머지할까요?`)) return;
  mergingIndex.value = pr.index;
  mergeError.value = "";
  try {
    await apiCall(`/projects/${props.id}/git/pulls/${pr.index}/merge`, { method: "POST" });
    await load();
  } catch (err) {
    mergeError.value = err instanceof ApiError ? err.message : "머지에 실패했습니다";
  } finally {
    mergingIndex.value = null;
  }
}

function stateLabel(pr: PullRequestSummary): string {
  if (pr.merged) return "머지됨";
  return pr.state === "open" ? "열림" : "닫힘";
}

onMounted(async () => {
  await checkRepo();
  if (hasRepo.value) await load();
  else loading.value = false;
});
</script>

<template>
  <section class="panel">
    <p v-if="loading">불러오는 중...</p>
    <p v-else-if="hasRepo === false" class="muted">
      연결된 git 저장소가 없습니다 - 설정 탭에서 먼저 연결하세요.
    </p>
    <template v-else>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="section">
        <h2>브랜치</h2>
        <ul class="branch-list">
          <li v-for="b in branches" :key="b.name">
            <span class="name">{{ b.name }}</span>
            <span class="at">{{ b.lastCommitAt ? new Date(b.lastCommitAt).toLocaleString() : "" }}</span>
            <router-link class="explore-btn" :to="`/projects/${id}/source?ref=${encodeURIComponent(b.name)}`">
              탐색
            </router-link>
          </li>
          <li v-if="branches.length === 0" class="muted">브랜치가 없습니다.</li>
        </ul>
      </div>

      <div class="section">
        <div class="pr-header">
          <h2>Pull Request</h2>
          <button v-if="canCreatePr" type="button" @click="showCreateForm = !showCreateForm">
            {{ showCreateForm ? "취소" : "PR 만들기" }}
          </button>
        </div>

        <form v-if="showCreateForm" class="create-form" @submit.prevent="createPull">
          <input v-model="newTitle" type="text" placeholder="제목" />
          <div class="branch-selects">
            <select v-model="newHead">
              <option value="">head 브랜치</option>
              <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
            </select>
            <span>→</span>
            <select v-model="newBase">
              <option value="">base 브랜치</option>
              <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
            </select>
          </div>
          <textarea v-model="newBody" placeholder="설명(선택)" rows="3"></textarea>
          <button type="submit" :disabled="creating || !newTitle.trim() || !newHead || !newBase">
            {{ creating ? "만드는 중..." : "PR 생성" }}
          </button>
          <p v-if="createError" class="error">{{ createError }}</p>
        </form>

        <p v-if="mergeError" class="error">{{ mergeError }}</p>
        <ul class="pr-list">
          <li v-for="pr in pulls" :key="pr.index">
            <div class="pr-row">
              <span class="pr-title">#{{ pr.index }} {{ pr.title }}</span>
              <span class="pr-state" :class="pr.merged ? 'merged' : pr.state">{{ stateLabel(pr) }}</span>
            </div>
            <div class="pr-meta">
              {{ pr.authorUsername }} - {{ pr.headBranch }} → {{ pr.baseBranch }} -
              {{ new Date(pr.createdAt).toLocaleString() }}
            </div>
            <p v-if="pr.body" class="pr-body">{{ pr.body }}</p>
            <button
              v-if="canMerge && !pr.merged && pr.state === 'open'"
              type="button"
              :disabled="mergingIndex === pr.index"
              @click="mergePull(pr)"
            >
              {{ mergingIndex === pr.index ? "머지 중..." : "머지" }}
            </button>
          </li>
          <li v-if="pulls.length === 0" class="muted">PR이 없습니다.</li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  font-size: 13px;
}
.section {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 16px;
  margin-bottom: 20px;
}
.section h2 {
  font-size: 14px;
  margin: 0 0 10px;
  color: var(--color-text-secondary);
}
.branch-list,
.pr-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.branch-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border-light);
}
.branch-list li:last-child {
  border-bottom: none;
}
.branch-list .name {
  font-weight: 600;
  flex: 1;
}
.branch-list .at {
  color: var(--color-text-faint);
  font-size: 11px;
}
.explore-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  text-decoration: none;
}
.pr-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pr-header button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
  padding: 12px;
  background: var(--color-surface-hover);
  border-radius: 8px;
  max-width: 480px;
}
.create-form input,
.create-form select,
.create-form textarea {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
}
.branch-selects {
  display: flex;
  align-items: center;
  gap: 8px;
}
.branch-selects select {
  flex: 1;
}
.create-form button[type="submit"] {
  align-self: flex-start;
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.create-form button:disabled {
  opacity: 0.6;
}
.pr-list li {
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border-light);
}
.pr-list li:last-child {
  border-bottom: none;
}
.pr-row {
  display: flex;
  align-items: center;
  gap: 10px;
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
}
.pr-state.open {
  color: var(--color-success);
}
.pr-state.merged {
  color: var(--color-primary);
}
.pr-meta {
  font-size: 11px;
  color: var(--color-text-faint);
  margin-top: 2px;
}
.pr-body {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 6px 0;
  white-space: pre-wrap;
}
.pr-list button {
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  padding: 5px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  margin-top: 4px;
}
.pr-list button:disabled {
  opacity: 0.6;
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
