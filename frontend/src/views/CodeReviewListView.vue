<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";
import StatusBadge from "../components/StatusBadge.vue";

const props = defineProps<{ id: string }>();
const router = useRouter();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canRequest = computed(() => roleSatisfies(myRole.value, "editor"));

interface ReviewSummary {
  id: string;
  prIndex: number | null;
  label: string;
  status: string;
  createdAt: string;
  findings: { id: string }[];
}
interface BranchSummary {
  name: string;
}

const reviews = ref<ReviewSummary[]>([]);
const branches = ref<BranchSummary[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [reviews.value, branches.value] = await Promise.all([
      apiCall<ReviewSummary[]>(`/projects/${props.id}/git/code-review`),
      apiCall<BranchSummary[]>(`/projects/${props.id}/git/branches`),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "코드 리뷰 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- 새 리뷰 요청
const showForm = ref(false);
const mode = ref<"pr" | "range">("pr");
const prIndex = ref("");
const rangeBase = ref("");
const rangeHead = ref("");
const label = ref("");
const requesting = ref(false);
const requestError = ref("");

async function requestReview() {
  requesting.value = true;
  requestError.value = "";
  try {
    const body: Record<string, unknown> = { label: label.value.trim() };
    if (mode.value === "pr") body.prIndex = Number(prIndex.value);
    else {
      body.base = rangeBase.value;
      body.head = rangeHead.value;
    }
    const result = await apiCall<{ id: string }>(`/projects/${props.id}/git/code-review/request`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    router.push(`/projects/${props.id}/code-review/${result.id}`);
  } catch (err) {
    requestError.value = err instanceof ApiError ? err.message : "요청에 실패했습니다";
  } finally {
    requesting.value = false;
  }
}

const canSubmit = computed(() => {
  if (!label.value.trim()) return false;
  if (mode.value === "pr") return prIndex.value.trim() !== "";
  return rangeBase.value !== "" && rangeHead.value !== "";
});

onMounted(load);
</script>

<template>
  <section class="panel">
    <div class="header">
      <h1>코드 리뷰(사후 검토)</h1>
    </div>

    <button v-if="canRequest" type="button" class="toggle-btn" @click="showForm = !showForm">
      {{ showForm ? "취소" : "새 리뷰 요청" }}
    </button>

    <form v-if="showForm" class="create-form" @submit.prevent="requestReview">
      <div class="mode-tabs">
        <button type="button" :class="{ active: mode === 'pr' }" @click="mode = 'pr'">PR 번호로</button>
        <button type="button" :class="{ active: mode === 'range' }" @click="mode = 'range'">브랜치 범위로</button>
      </div>
      <input v-if="mode === 'pr'" v-model="prIndex" type="number" min="1" placeholder="PR 번호" />
      <div v-else class="branch-selects">
        <select v-model="rangeBase">
          <option value="">base 브랜치</option>
          <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
        </select>
        <span>→</span>
        <select v-model="rangeHead">
          <option value="">head 브랜치</option>
          <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
        </select>
      </div>
      <input v-model="label" type="text" placeholder="라벨 (예: PR#12 사후 검토, main 최근 변경)" />
      <button type="submit" :disabled="requesting || !canSubmit">{{ requesting ? "요청 중..." : "리뷰 요청" }}</button>
      <p v-if="requestError" class="error">{{ requestError }}</p>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else>
      <ul class="review-list">
        <li v-for="r in reviews" :key="r.id">
          <router-link class="review-row" :to="`/projects/${id}/code-review/${r.id}`">
            <span class="review-label">{{ r.label }}</span>
            <StatusBadge :code="r.status" />
          </router-link>
          <div class="review-meta">
            <router-link v-if="r.prIndex !== null" :to="`/projects/${id}/repo/pulls/${r.prIndex}`">PR #{{ r.prIndex }}</router-link>
            <span>발견 {{ r.findings.length }}건</span>
            <span>{{ new Date(r.createdAt).toLocaleString() }}</span>
          </div>
        </li>
        <li v-if="reviews.length === 0" class="muted">아직 리뷰가 없습니다.</li>
      </ul>
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
.toggle-btn {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 12px;
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 16px;
  padding: 12px;
  background: var(--color-surface-hover);
  border-radius: 8px;
  max-width: 480px;
}
.mode-tabs {
  display: flex;
  gap: 6px;
}
.mode-tabs button {
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
}
.mode-tabs button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.create-form input,
.create-form select {
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
.review-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.review-list li {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
}
.review-list li:last-child {
  border-bottom: none;
}
.review-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  text-decoration: none;
}
.review-label {
  font-weight: 600;
  flex: 1;
}
.review-meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--color-text-faint);
  margin-top: 2px;
}
.review-meta a {
  color: var(--color-primary);
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
