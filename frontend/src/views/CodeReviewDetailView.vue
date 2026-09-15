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

interface Comment {
  id: string;
  findingId: string | null;
  body: string;
  authorId: string;
  createdAt: string;
}
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
  comments: Comment[];
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
const diffFiles = computed<FileDiff[]>(() => parseUnifiedDiff(diffText.value));

// diff와 발견 항목을 따로 나열하지 않고 파일 단위로 묶는다(설계자
// 요청 - "코드 리뷰 단위를 파일 단위로 볼 수는 없나") - 파일 하나의
// diff와 그 파일에 달린 finding을 나란히 보면서 검토할 수 있게.
// 같은 파일이 이 범위 안 여러 커밋에서 바뀌었으면 diff 카드가
// 여러 개일 수 있다(gitea.compareDiff가 커밋별 diff를 이어붙이는
// 방식이라 - core/gitea.ts 참고) - 그 전부를 한 그룹에 묶는다.
// finding이 가리키는 파일이 diff 목록에 없는 예외적인 경우(예: AI가
// 범위 밖 파일을 언급)도 파일 목록 뒤에 별도 그룹으로 붙여 놓친 finding이
// 없게 한다.
interface FileGroup {
  filePath: string;
  diffs: FileDiff[];
  findings: Finding[];
}
const fileGroups = computed<FileGroup[]>(() => {
  if (!review.value) return [];
  const order: string[] = [];
  const diffsByPath = new Map<string, FileDiff[]>();
  for (const f of diffFiles.value) {
    const path = f.newPath !== "/dev/null" ? f.newPath : f.oldPath;
    if (!diffsByPath.has(path)) {
      diffsByPath.set(path, []);
      order.push(path);
    }
    diffsByPath.get(path)!.push(f);
  }
  const findingsByPath = new Map<string, Finding[]>();
  for (const finding of review.value.findings) {
    if (!findingsByPath.has(finding.filePath)) findingsByPath.set(finding.filePath, []);
    findingsByPath.get(finding.filePath)!.push(finding);
  }
  for (const path of findingsByPath.keys()) {
    if (!diffsByPath.has(path)) order.push(path);
  }
  return order.map((filePath) => ({
    filePath,
    diffs: diffsByPath.get(filePath) ?? [],
    findings: (findingsByPath.get(filePath) ?? [])
      .slice()
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)),
  }));
});

// 코멘트는 서버가 findingId 유무로 구분해서 한 배열로 주므로
// 프론트에서 finding별/리뷰 전체용으로 나눠 쓴다.
const reviewComments = computed(() => review.value?.comments.filter((c) => c.findingId === null) ?? []);
const commentsByFinding = computed(() => {
  const map = new Map<string, Comment[]>();
  for (const c of review.value?.comments ?? []) {
    if (!c.findingId) continue;
    if (!map.has(c.findingId)) map.set(c.findingId, []);
    map.get(c.findingId)!.push(c);
  }
  return map;
});

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

// findingId 없는 항목은 "리뷰 전체" 초안용 키("review")를 따로 둔다.
const commentDrafts = ref<Record<string, string>>({});
const postingComment = ref("");
async function postComment(findingId: string | null) {
  const key = findingId ?? "review";
  const body = (commentDrafts.value[key] ?? "").trim();
  if (!body) return;
  postingComment.value = key;
  try {
    await apiCall(`/projects/${props.id}/git/code-review/${props.reviewId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, findingId }),
    });
    commentDrafts.value[key] = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "코멘트 등록에 실패했습니다";
  } finally {
    postingComment.value = "";
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
        <h2>리뷰 전체 메모 ({{ reviewComments.length }}건)</h2>
        <ul v-if="reviewComments.length > 0" class="comment-list">
          <li v-for="c in reviewComments" :key="c.id">
            <span class="c-meta">{{ c.authorId.slice(0, 8) }} · {{ new Date(c.createdAt).toLocaleString() }}</span>
            <p class="c-body">{{ c.body }}</p>
          </li>
        </ul>
        <div v-if="canAct" class="comment-form">
          <textarea v-model="commentDrafts.review" rows="2" placeholder="이 리뷰 전체에 대한 메모(스코프 고지 등)" />
          <button type="button" :disabled="postingComment === 'review' || !commentDrafts.review?.trim()" @click="postComment(null)">
            메모 추가
          </button>
        </div>
      </section>

      <section class="block">
        <h2>파일별 변경 및 발견 항목 (발견 {{ review.findings.length }}건)</h2>
        <p v-if="diffError" class="error">{{ diffError }}</p>
        <p v-if="diffLoading">불러오는 중...</p>
        <div v-else-if="fileGroups.length > 0" class="file-groups">
          <div v-for="group in fileGroups" :key="group.filePath" class="file-group">
            <DiffFileList v-if="group.diffs.length > 0" :files="group.diffs" />
            <div v-else class="no-diff">
              <span class="f-location">{{ group.filePath }}</span>
              <span class="muted">(이 범위의 diff에는 없는 파일)</span>
            </div>
            <ul v-if="group.findings.length > 0" class="finding-list nested">
              <li v-for="f in group.findings" :key="f.id">
                <div class="f-row">
                  <StatusBadge :code="f.severity" />
                  <span class="f-location"><template v-if="f.line">:{{ f.line }}</template></span>
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
                <ul v-if="(commentsByFinding.get(f.id)?.length ?? 0) > 0" class="comment-list">
                  <li v-for="c in commentsByFinding.get(f.id)" :key="c.id">
                    <span class="c-meta">{{ c.authorId.slice(0, 8) }} · {{ new Date(c.createdAt).toLocaleString() }}</span>
                    <p class="c-body">{{ c.body }}</p>
                  </li>
                </ul>
                <div v-if="canAct" class="comment-form">
                  <textarea v-model="commentDrafts[f.id]" rows="2" placeholder="이 발견 항목에 대한 코멘트(판단 근거 등)" />
                  <button type="button" :disabled="postingComment === f.id || !commentDrafts[f.id]?.trim()" @click="postComment(f.id)">
                    코멘트 추가
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="muted">변경된 파일이 없습니다.</p>
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
.file-groups {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.no-diff {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-surface);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
}
.finding-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.finding-list.nested {
  margin-top: 8px;
  padding-left: 16px;
  border-left: 2px solid var(--color-border-light);
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
.comment-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 8px 0 0;
  border-top: 1px solid var(--color-border-light);
}
.comment-list li {
  margin-bottom: 6px;
}
.c-meta {
  font-size: 11px;
  color: var(--color-text-faint);
  font-family: monospace;
}
.c-body {
  margin: 2px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
}
.comment-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.comment-form textarea {
  font: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-light);
  background: var(--color-bg);
  color: var(--color-text);
  resize: vertical;
}
.comment-form button {
  align-self: flex-start;
  background: var(--color-surface-hover);
  color: var(--color-text);
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.comment-form button:disabled {
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
