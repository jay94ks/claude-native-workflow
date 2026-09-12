<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";
import MarkdownBody from "../components/MarkdownBody.vue";
import PullRequestTimeline from "../components/PullRequestTimeline.vue";

const props = defineProps<{ id: string; index: string }>();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canMerge = computed(() => roleSatisfies(myRole.value, "owner"));
const canAct = computed(() => roleSatisfies(myRole.value, "editor"));

interface PullRequestDetail {
  index: number;
  title: string;
  body: string;
  state: string;
  authorUsername: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
  createdAt: string;
  disposition: "merged" | "rejected" | null;
  lastMergeError: string | null;
}
interface PullRequestCommit {
  sha: string;
  message: string;
  authorName: string;
  authoredAt: string;
}
interface PullRequestComment {
  id: number;
  body: string;
  authorUsername: string;
  createdAt: string;
}
interface TimelineEntry {
  id: number;
  type: string;
  body: string;
  authorUsername: string | null;
  createdAt: string;
}
interface MessageItem {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

const pr = ref<PullRequestDetail | null>(null);
const commits = ref<PullRequestCommit[]>([]);
const comments = ref<PullRequestComment[]>([]);
const timeline = ref<TimelineEntry[]>([]);
const messages = ref<MessageItem[]>([]);
const loading = ref(true);
const error = ref("");

const basePath = () => `/projects/${props.id}/git/pulls/${props.index}`;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [pr.value, commits.value, comments.value, timeline.value, messages.value] = await Promise.all([
      apiCall<PullRequestDetail>(basePath()),
      apiCall<PullRequestCommit[]>(`${basePath()}/commits`),
      apiCall<PullRequestComment[]>(`${basePath()}/comments`),
      apiCall<TimelineEntry[]>(`${basePath()}/timeline`),
      apiCall<MessageItem[]>(`${basePath()}/messages`),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "PR을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function stateLabel(): string {
  if (!pr.value) return "";
  if (pr.value.disposition === "merged" || pr.value.merged) return "머지됨";
  if (pr.value.disposition === "rejected") return "거부됨";
  return pr.value.state === "open" ? "열림" : "닫힘";
}
function stateClass(): string {
  if (!pr.value) return "";
  return pr.value.disposition ?? (pr.value.merged ? "merged" : pr.value.state);
}

// ---------------------------------------------------------------- 액션(머지/수동 병합/거부/닫기/재오픈)
const actionError = ref("");
const acting = ref(false);

async function runAction(path: string, confirmMsg?: string) {
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  acting.value = true;
  actionError.value = "";
  try {
    await apiCall(`${basePath()}${path}`, { method: "POST" });
    await load();
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : "처리에 실패했습니다";
  } finally {
    acting.value = false;
  }
}

const mergeCommitId = ref("");
const mergingManually = ref(false);

async function mergeManually() {
  if (!mergeCommitId.value.trim()) return;
  mergingManually.value = true;
  actionError.value = "";
  try {
    await apiCall(`${basePath()}/merge-manually`, {
      method: "POST",
      body: JSON.stringify({ mergeCommitId: mergeCommitId.value.trim() }),
    });
    mergeCommitId.value = "";
    await load();
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : "수동 병합 기록에 실패했습니다";
  } finally {
    mergingManually.value = false;
  }
}

// ---------------------------------------------------------------- 대화(댓글)
const newComment = ref("");
const addingComment = ref(false);
const commentError = ref("");

async function addComment() {
  if (!newComment.value.trim()) return;
  addingComment.value = true;
  commentError.value = "";
  try {
    await apiCall(`${basePath()}/comments`, { method: "POST", body: JSON.stringify({ body: newComment.value.trim() }) });
    newComment.value = "";
    comments.value = await apiCall<PullRequestComment[]>(`${basePath()}/comments`);
  } catch (err) {
    commentError.value = err instanceof ApiError ? err.message : "댓글 등록에 실패했습니다";
  } finally {
    addingComment.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="panel">
    <router-link :to="`/projects/${id}/repo/pulls`" class="back-link">← PR 목록으로</router-link>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else-if="pr">
      <div class="header">
        <h1>#{{ pr.index }} {{ pr.title }}</h1>
        <span class="pr-state" :class="stateClass()">{{ stateLabel() }}</span>
      </div>
      <div class="meta">
        {{ pr.authorUsername }} - {{ pr.headBranch }} → {{ pr.baseBranch }} -
        {{ new Date(pr.createdAt).toLocaleString() }}
      </div>
      <MarkdownBody v-if="pr.body" :body="pr.body" class="body" />

      <p v-if="actionError" class="error">{{ actionError }}</p>

      <div v-if="pr.lastMergeError" class="merge-error-banner">
        <p><strong>자동 머지 실패</strong> - {{ pr.lastMergeError }}</p>
        <p class="hint">
          로컬 클론에서 직접(또는 AI가 CLI로) 충돌을 해결해 {{ pr.baseBranch }}로 push한 뒤, 그 결과 커밋의 SHA를 아래에
          입력하면 Gitea에 병합 완료로 기록됩니다.
        </p>
        <form v-if="canMerge" class="manual-merge-form" @submit.prevent="mergeManually">
          <input v-model="mergeCommitId" type="text" placeholder="커밋 SHA" />
          <button type="submit" :disabled="mergingManually || !mergeCommitId.trim()">
            {{ mergingManually ? "기록 중..." : "수동 병합 완료로 기록" }}
          </button>
        </form>
      </div>

      <div class="actions">
        <button
          v-if="canMerge && pr.state === 'open' && !pr.merged"
          type="button"
          :disabled="acting"
          @click="runAction('/merge', `PR #${pr.index}을(를) ${pr.baseBranch}에 머지할까요?`)"
        >
          머지
        </button>
        <button
          v-if="canAct && pr.state === 'open' && !pr.merged"
          type="button"
          class="danger"
          :disabled="acting"
          @click="runAction('/reject', `PR #${pr.index}을(를) 거부할까요?`)"
        >
          거부
        </button>
        <button
          v-if="canAct && pr.state === 'open' && !pr.merged"
          type="button"
          class="secondary"
          :disabled="acting"
          @click="runAction('/close', `PR #${pr.index}을(를) 닫을까요?`)"
        >
          닫기
        </button>
        <button
          v-if="canAct && pr.state === 'closed' && !pr.merged"
          type="button"
          :disabled="acting"
          @click="runAction('/reopen')"
        >
          다시 열기
        </button>
      </div>

      <section class="block">
        <h2>메시지</h2>
        <ul v-if="messages.length > 0" class="list">
          <li v-for="m in messages" :key="m.id">
            <span class="body-text">{{ m.body }}</span>
            <span class="at">{{ new Date(m.createdAt).toLocaleString() }}</span>
          </li>
        </ul>
        <p v-else class="muted">아직 기록된 메시지가 없습니다.</p>
      </section>

      <section class="block">
        <h2>커밋</h2>
        <ul v-if="commits.length > 0" class="list commits">
          <li v-for="c in commits" :key="c.sha">
            <code>{{ c.sha.slice(0, 8) }}</code>
            <span class="body-text">{{ c.message.split("\n")[0] }}</span>
            <span class="at">{{ c.authorName }} - {{ new Date(c.authoredAt).toLocaleString() }}</span>
          </li>
        </ul>
        <p v-else class="muted">커밋이 없습니다.</p>
      </section>

      <section class="block">
        <h2>대화</h2>
        <ul v-if="comments.length > 0" class="list">
          <li v-for="c in comments" :key="c.id">
            <div class="c-row">
              <span class="author">{{ c.authorUsername }}</span>
              <span class="at">{{ new Date(c.createdAt).toLocaleString() }}</span>
            </div>
            <MarkdownBody :body="c.body" />
          </li>
        </ul>
        <p v-else class="muted">아직 대화가 없습니다.</p>
        <form v-if="canAct" class="add-row" @submit.prevent="addComment">
          <textarea v-model="newComment" rows="2" placeholder="댓글 입력... (Markdown 가능)"></textarea>
          <button type="submit" :disabled="addingComment">등록</button>
        </form>
        <p v-if="commentError" class="error">{{ commentError }}</p>
      </section>

      <section class="block">
        <h2>진행 내역</h2>
        <PullRequestTimeline :entries="timeline" />
      </section>
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
.pr-state {
  font-size: 11px;
  padding: 3px 10px;
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
.pr-state.rejected {
  color: var(--color-danger);
}
.meta {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 4px 0 12px;
}
.body {
  margin-bottom: 16px;
}
.merge-error-banner {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.merge-error-banner .hint {
  font-size: 12px;
  margin: 6px 0 10px;
}
.manual-merge-form {
  display: flex;
  gap: 8px;
}
.manual-merge-form input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: monospace;
  background: var(--color-surface);
  color: var(--color-text);
}
.actions {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.actions button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.actions button.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
.actions button.danger {
  background: var(--color-danger);
}
.actions button:disabled,
.manual-merge-form button:disabled {
  opacity: 0.6;
}
.manual-merge-form button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
}
.block {
  margin-top: 24px;
}
.block h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border-light);
}
.list li:last-child {
  border-bottom: none;
}
.list.commits li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.list.commits code {
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.body-text {
  flex: 1;
  font-size: 13px;
}
.at {
  color: var(--color-text-faint);
  font-size: 11px;
  flex-shrink: 0;
}
.c-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin-bottom: 4px;
}
.c-row .author {
  font-weight: 600;
  font-size: 13px;
}
.add-row {
  display: flex;
  gap: 8px;
}
.add-row textarea {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
}
.add-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  align-self: flex-start;
}
.add-row button:disabled {
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
