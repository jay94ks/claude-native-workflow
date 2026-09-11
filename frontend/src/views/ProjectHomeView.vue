<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "../components/UserRef.vue";

const props = defineProps<{ id: string }>();

interface PendingQuestion {
  trackingCode: string;
  documentTrackingCode: string;
  documentTitle: string;
  text: string;
  status: string;
}
interface RecentDocument {
  trackingCode: string;
  title: string;
}
interface RecentComment {
  id: string;
  trackingCode: string;
  documentTitle: string;
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

onMounted(load);
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <section v-if="!loading && pending.length > 0">
    <h2>답변 대기 질문</h2>
    <ul class="list">
      <li v-for="q in pending" :key="q.trackingCode">
        <router-link :to="`/projects/${id}/documents/${q.documentTrackingCode}`">
          <code>{{ q.trackingCode }}</code> {{ q.documentTitle }} - {{ q.text }}
        </router-link>
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
        <router-link :to="`/projects/${id}/documents/${c.trackingCode}`">
          <code>{{ c.trackingCode }}</code> {{ c.documentTitle }} - {{ c.body }}
        </router-link>
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
  color: #3454d1;
  text-decoration: none;
}
.section-header a:hover {
  text-decoration: underline;
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
  padding: 10px 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.list li:last-child {
  border-bottom: none;
}
.list li a {
  color: #1a1a2e;
  text-decoration: none;
  font-size: 13px;
}
.list li a code {
  font-size: 11px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
.list li a:hover {
  text-decoration: underline;
}
.msg-body {
  font-size: 13px;
  color: #1a1a2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.right {
  flex-shrink: 0;
  margin-left: 12px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
.muted {
  color: #888;
  font-size: 13px;
}
</style>
