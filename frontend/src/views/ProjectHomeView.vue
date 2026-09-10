<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ id: string }>();

interface PendingQuestion {
  trackingCode: string;
  documentTrackingCode: string;
  documentTitle: string;
  text: string;
  status: string;
}

const pending = ref<PendingQuestion[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await apiCall<{ questions: PendingQuestion[] }>(`/projects/${props.id}/pending`).catch(() => ({ questions: [] }));
    // "pending"(설계자 답변 완료, AI 확인 대기)은 AI가 처리할 몫이라
    // 설계자 화면엔 노이즈로 안 얹는다 - "open"(설계자가 지금 답해야
    // 할 것)만 보여준다.
    pending.value = result.questions.filter((q) => q.status === "open");
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
  <p v-else-if="!loading" class="muted">답변 대기 중인 질문이 없습니다. "메시지" 탭에서 메시지를 확인하세요.</p>
</template>

<style scoped>
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
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
.error {
  color: #d1344b;
  font-size: 13px;
}
.muted {
  color: #888;
  font-size: 13px;
}
</style>
