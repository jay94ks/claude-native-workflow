<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiCall, apiCallText, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { useToastStore } from "../stores/toast";
import { parseUnifiedDiff, type FileDiff } from "../utils/diffParse";
import DiffFileList from "../components/DiffFileList.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";

const props = defineProps<{ id: string; reviewId: string }>();
const router = useRouter();
const toast = useToastStore();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canAct = computed(() => roleSatisfies(myRole.value, "editor"));

interface Finding {
  id: string;
  filePath: string;
  line: number | null;
  category: string;
  severity: "blocker" | "major" | "minor" | "nit";
  summary: string;
  failureScenario: string;
  verdict: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  followUpRef: string | null;
  createdAt: string;
}
interface ReviewDetail {
  id: string;
  projectId: string;
  prIndex: number | null;
  label: string;
  baseRef: string;
  headRef: string;
  triggeredBy: string;
  requestedBy: string | null;
  status: string;
  aiSummary: string | null;
  createdAt: string;
  completedAt: string | null;
  findings: Finding[];
}

const review = ref<ReviewDetail | null>(null);
const loading = ref(true);
const error = ref("");
const diffText = ref("");
const diffLoading = ref(false);
const diffError = ref("");

// 심각도 내림차순(blocker가 맨 위) - 이 세션이 코드 리뷰에 쓰는
// ReportFindings 도구의 "most-severe-first" 관례와 동일.
const SEVERITY_RANK: Record<string, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };
const sortedFindings = computed(() => {
  if (!review.value) return [];
  return [...review.value.findings].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
});
const diffFiles = computed<FileDiff[]>(() => parseUnifiedDiff(diffText.value));

async function loadDiff(r: ReviewDetail) {
  diffLoading.value = true;
  diffError.value = "";
  try {
    const qs = new URLSearchParams({ base: r.baseRef, head: r.headRef });
    diffText.value = await apiCallText(`/projects/${props.id}/git/compare?${qs}`);
  } catch (err) {
    diffError.value = err instanceof ApiError ? err.message : "diff를 불러오지 못했습니다";
  } finally {
    diffLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    review.value = await apiCall<ReviewDetail>(`/projects/${props.id}/git/code-review/${props.reviewId}`);
    await loadDiff(review.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "리뷰를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

const resolvingId = ref("");
async function resolveFinding(findingId: string, status: string) {
  resolvingId.value = findingId;
  try {
    await apiCall(`/projects/${props.id}/git/code-review/findings/${findingId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "트리아지에 실패했습니다";
  } finally {
    resolvingId.value = "";
  }
}

const deleting = ref(false);
const deleteError = ref("");
async function deleteReview() {
  if (!window.confirm("이 리뷰를 삭제할까요?")) return;
  deleting.value = true;
  deleteError.value = "";
  try {
    await apiCall(`/projects/${props.id}/git/code-review/${props.reviewId}`, { method: "DELETE" });
    router.push(`/projects/${props.id}/code-review`);
  } catch (err) {
    deleteError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  } finally {
    deleting.value = false;
  }
}

let disconnectRealtime: (() => void) | null = null;
onMounted(async () => {
  await load();
  disconnectRealtime = await connectProjectRealtime(props.id, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "codeReview" && event.id === props.reviewId) {
        toast.push("리뷰가 갱신되었습니다.");
        load();
      }
    },
  });
});
onUnmounted(() => disconnectRealtime?.());
</script>

<template>
  <section class="panel">
    <router-link :to="`/projects/${id}/code-review`" class="back-link">← 코드 리뷰 목록으로</router-link>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>
    <template v-else-if="review">
      <div class="header">
        <h1>{{ review.label }}</h1>
        <StatusBadge :code="review.status" />
      </div>
      <div class="meta">
        <span v-if="review.prIndex !== null">
          <router-link :to="`/projects/${id}/repo/pulls/${review.prIndex}`">PR #{{ review.prIndex }}</router-link> -
        </span>
        {{ review.baseRef.slice(0, 8) }} → {{ review.headRef.slice(0, 8) }} -
        {{ new Date(review.createdAt).toLocaleString() }}
      </div>
      <p v-if="review.aiSummary" class="summary">{{ review.aiSummary }}</p>

      <section class="block">
        <h2>변경 내용</h2>
        <p v-if="diffError" class="error">{{ diffError }}</p>
        <p v-if="diffLoading">불러오는 중...</p>
        <DiffFileList v-else-if="diffFiles.length > 0" :files="diffFiles" />
        <p v-else class="muted">변경된 파일이 없습니다.</p>
      </section>

      <section class="block">
        <h2>발견 항목 ({{ review.findings.length }})</h2>
        <ul v-if="sortedFindings.length > 0" class="finding-list">
          <li v-for="f in sortedFindings" :key="f.id">
            <div class="f-row">
              <StatusBadge :code="f.severity" />
              <span class="f-location">{{ f.filePath }}<template v-if="f.line">:{{ f.line }}</template></span>
              <StatusBadge :code="f.status" />
            </div>
            <p class="f-summary">{{ f.summary }}</p>
            <p class="f-scenario">{{ f.failureScenario }}</p>
            <p class="f-meta">
              <span>{{ f.category }}</span>
              <span v-if="f.verdict"> · {{ f.verdict }}</span>
              <span v-if="f.followUpRef"> · 후속: <TrackingCodeText :text="f.followUpRef" /></span>
            </p>
            <div v-if="canAct && f.status === 'open'" class="f-actions">
              <button type="button" :disabled="resolvingId === f.id" @click="resolveFinding(f.id, 'fixed')">해결됨</button>
              <button type="button" class="secondary" :disabled="resolvingId === f.id" @click="resolveFinding(f.id, 'wontfix')">
                보류
              </button>
              <button
                type="button"
                class="secondary"
                :disabled="resolvingId === f.id"
                @click="resolveFinding(f.id, 'false_positive')"
              >
                오탐
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="muted">발견된 항목이 없습니다.</p>
      </section>

      <p v-if="deleteError" class="error">{{ deleteError }}</p>
      <button
        v-if="canAct && review.findings.length === 0"
        type="button"
        class="delete-btn"
        :disabled="deleting"
        @click="deleteReview"
      >
        {{ deleting ? "삭제 중..." : "리뷰 삭제(취소)" }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.panel {
  font-size: 13px;
}
.back-link {
  display: inline-block;
  margin-bottom: 12px;
  color: var(--color-primary);
  font-size: 13px;
  text-decoration: none;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
h1 {
  font-size: 18px;
  margin: 0;
}
.meta {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 4px 0 12px;
  font-family: monospace;
}
.meta a {
  color: var(--color-primary);
}
.summary {
  background: var(--color-surface);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 8px;
}
.block {
  margin-top: 24px;
}
.block h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.finding-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.finding-list li {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 12px 14px;
  margin-bottom: 10px;
}
.f-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.f-location {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
  flex: 1;
}
.f-summary {
  font-weight: 600;
  margin: 0 0 4px;
}
.f-scenario {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin: 0 0 6px;
}
.f-meta {
  font-size: 11px;
  color: var(--color-text-faint);
  margin: 0 0 8px;
}
.f-actions {
  display: flex;
  gap: 8px;
}
.f-actions button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.f-actions button.secondary {
  background: var(--color-surface-hover);
  color: var(--color-text);
}
.f-actions button:disabled {
  opacity: 0.6;
}
.delete-btn {
  margin-top: 20px;
  background: var(--color-danger);
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.delete-btn:disabled {
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
