<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "../components/UserRef.vue";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";

const props = defineProps<{ id: string }>();
const kanbanDialog = useKanbanCardDialogStore();

interface PendingQuestion {
  trackingCode: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  text: string;
  status: string;
}
interface RecentDocument {
  trackingCode: string;
  title: string;
}
interface RecentComment {
  id: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  body: string;
  authorId: string;
}
interface RecentMessage {
  id: string;
  authorId: string | null;
  body: string;
}

const pending = ref<PendingQuestion[]>([]);
const recentDocuments = ref<RecentDocument[]>([]);
const recentComments = ref<RecentComment[]>([]);
const recentMessages = ref<RecentMessage[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [pendingResult, docs, comments, messages] = await Promise.all([
      apiCall<{ questions: PendingQuestion[] }>(`/projects/${props.id}/pending`).catch(() => ({ questions: [] })),
      apiCall<RecentDocument[]>(`/projects/${props.id}/documents/recent?limit=5`).catch(() => []),
      apiCall<RecentComment[]>(`/projects/${props.id}/comments/recent?limit=5`).catch(() => []),
      apiCall<RecentMessage[]>(`/projects/${props.id}/messages/recent?limit=5`).catch(() => []),
    ]);
    // "pending"(설계자 답변 완료, AI 확인 대기)은 AI가 처리할 몫이라
    // 설계자 화면엔 노이즈로 안 얹는다 - "open"(설계자가 지금 답해야
    // 할 것)만 보여준다.
    pending.value = pendingResult.questions.filter((q) => q.status === "open");
    recentDocuments.value = docs;
    recentComments.value = comments;
    recentMessages.value = messages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function openQuestionTarget(q: PendingQuestion) {
  if (q.targetType === "kanbanCard") kanbanDialog.show(q.targetKey);
}

function openCommentTarget(c: RecentComment) {
  if (c.targetType === "kanbanCard") kanbanDialog.show(c.targetKey);
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <section v-if="!loading && pending.length > 0">
    <h2>답변 대기 질문</h2>
    <ul class="list">
      <li v-for="q in pending" :key="q.trackingCode">
        <router-link v-if="q.targetType === 'document'" :to="`/projects/${id}/documents/${q.targetKey}`">
          <code>{{ q.trackingCode }}</code> {{ q.targetLabel }} - {{ q.text }}
        </router-link>
        <router-link v-else-if="q.targetType === 'source'" :to="`/projects/${id}/source?path=${encodeURIComponent(q.targetKey)}`">
          <code>{{ q.trackingCode }}</code> {{ q.targetLabel }} - {{ q.text }}
        </router-link>
        <button v-else type="button" class="target-link" @click="openQuestionTarget(q)">
          <code>{{ q.trackingCode }}</code> {{ q.targetLabel }} - {{ q.text }}
        </button>
      </li>
    </ul>
  </section>
  <p v-else-if="!loading" class="muted">답변 대기 중인 질문이 없습니다.</p>

  <section v-if="!loading">
    <div class="section-header">
      <h2>최근 변경 문서</h2>
      <router-link :to="`/projects/${id}/documents?recent=1`">더보기</router-link>
    </div>
    <ul v-if="recentDocuments.length > 0" class="list">
      <li v-for="d in recentDocuments" :key="d.trackingCode">
        <router-link :to="`/projects/${id}/documents/${d.trackingCode}`">
          <code>{{ d.trackingCode }}</code> {{ d.title }}
        </router-link>
      </li>
    </ul>
    <p v-else class="muted">최근 변경된 문서가 없습니다.</p>
  </section>

  <section v-if="!loading">
    <div class="section-header">
      <h2>최근 코멘트</h2>
      <router-link :to="`/projects/${id}/comments`">더보기</router-link>
    </div>
    <ul v-if="recentComments.length > 0" class="list">
      <li v-for="c in recentComments" :key="c.id">
        <router-link v-if="c.targetType === 'document'" :to="`/projects/${id}/documents/${c.targetKey}`">
          {{ c.targetLabel }} - {{ c.body }}
        </router-link>
        <router-link v-else-if="c.targetType === 'source'" :to="`/projects/${id}/source?path=${encodeURIComponent(c.targetKey)}`">
          {{ c.targetLabel }} - {{ c.body }}
        </router-link>
        <button v-else type="button" class="target-link" @click="openCommentTarget(c)">{{ c.targetLabel }} - {{ c.body }}</button>
        <span class="right"><UserRef :user-id="c.authorId" /></span>
      </li>
    </ul>
    <p v-else class="muted">최근 코멘트가 없습니다.</p>
  </section>

  <section v-if="!loading">
    <div class="section-header">
      <h2>최근 발신 메시지</h2>
      <router-link :to="`/projects/${id}/messages`">더보기</router-link>
    </div>
    <ul v-if="recentMessages.length > 0" class="list">
      <li v-for="m in recentMessages" :key="m.id">
        <span class="msg-body">{{ m.body }}</span>
        <span class="right" v-if="m.authorId"><UserRef :user-id="m.authorId" /></span>
      </li>
    </ul>
    <p v-else class="muted">최근 발신한 메시지가 없습니다.</p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
}
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.section-header h2 {
  margin: 0;
}
.section-header a {
  font-size: 12px;
  color: var(--color-primary);
  text-decoration: none;
}
.section-header a:hover {
  text-decoration: underline;
}
.list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.list li:last-child {
  border-bottom: none;
}
.list li a {
  color: var(--color-text);
  text-decoration: none;
  font-size: 13px;
}
.list li a code {
  font-size: 11px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
.list li a:hover {
  text-decoration: underline;
}
.target-link {
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 13px;
  text-align: left;
  padding: 0;
  cursor: pointer;
}
.target-link:hover {
  text-decoration: underline;
}
.msg-body {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.right {
  flex-shrink: 0;
  margin-left: 12px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
