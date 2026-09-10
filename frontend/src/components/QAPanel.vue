<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";

const props = defineProps<{ projectId: string; trackingCode: string }>();
const emit = defineEmits<{ statusTransitioned: [statusCode: string] }>();

interface AnswerDetail {
  body: string;
  answeredBy: string;
  answeredAt: string;
}
interface QuestionItem {
  trackingCode: string;
  ordinal: number;
  text: string;
  status: string;
  answer: AnswerDetail | null;
}

const questions = ref<QuestionItem[]>([]);
const loading = ref(true);
const error = ref("");

const newQuestion = ref("");
const asking = ref(false);

const answerDrafts = ref<Record<string, string>>({});
const answering = ref<Record<string, boolean>>({});
const transitionNotice = ref("");

let disconnect: (() => void) | null = null;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    questions.value = await apiCall<QuestionItem[]>(`/documents/${props.trackingCode}/questions`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "질문을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function askQuestion() {
  if (!newQuestion.value.trim()) return;
  asking.value = true;
  error.value = "";
  try {
    await apiCall(`/documents/${props.trackingCode}/questions`, {
      method: "POST",
      body: JSON.stringify({ text: newQuestion.value.trim() }),
    });
    newQuestion.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "질문 등록에 실패했습니다";
  } finally {
    asking.value = false;
  }
}

async function answer(q: QuestionItem) {
  const body = (answerDrafts.value[q.trackingCode] ?? "").trim();
  if (!body) return;
  answering.value = { ...answering.value, [q.trackingCode]: true };
  error.value = "";
  transitionNotice.value = "";
  try {
    const result = await apiCall<{ documentStatusTransitioned: string | null }>(
      `/questions/${q.trackingCode}/answer`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    answerDrafts.value = { ...answerDrafts.value, [q.trackingCode]: "" };
    if (result.documentStatusTransitioned) {
      transitionNotice.value = `문서 상태가 "${result.documentStatusTransitioned}"로 자동 전이됨`;
      emit("statusTransitioned", result.documentStatusTransitioned);
    }
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "답변 등록에 실패했습니다";
  } finally {
    answering.value = { ...answering.value, [q.trackingCode]: false };
  }
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.projectId, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "question" || event.entity === "answer") load();
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section class="panel">
    <h2>질의/답변</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="transitionNotice" class="notice">{{ transitionNotice }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="questions">
      <li v-for="q in questions" :key="q.trackingCode">
        <div class="q-row">
          <code>{{ q.trackingCode }}</code>
          <span class="status" :class="q.status">{{ q.status }}</span>
          <span class="text">{{ q.text }}</span>
        </div>
        <div v-if="q.answer" class="answer">
          <span class="body">{{ q.answer.body }}</span>
          <span class="meta">{{ q.answer.answeredBy }} · {{ new Date(q.answer.answeredAt).toLocaleString() }}</span>
        </div>
        <form v-else class="answer-row" @submit.prevent="answer(q)">
          <input v-model="answerDrafts[q.trackingCode]" type="text" placeholder="답변 입력..." />
          <button type="submit" :disabled="answering[q.trackingCode]">답변</button>
        </form>
      </li>
      <li v-if="questions.length === 0" class="muted">아직 질문이 없습니다.</li>
    </ul>
    <form class="ask-row" @submit.prevent="askQuestion">
      <input v-model="newQuestion" type="text" placeholder="새 질문 등록..." />
      <button type="submit" :disabled="asking">질문 등록</button>
    </form>
  </section>
</template>

<style scoped>
.panel {
  margin-bottom: 28px;
}
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.questions {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.questions li {
  padding: 10px 14px;
  border-bottom: 1px solid #eee;
}
.questions li:last-child {
  border-bottom: none;
}
.q-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
}
.q-row code {
  font-size: 11px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef0f6;
  color: #555;
  flex-shrink: 0;
}
.status.answered {
  background: #e3f6ec;
  color: #1f9254;
}
.status.open {
  background: #fdf0e3;
  color: #b96a1a;
}
.text {
  flex: 1;
}
.answer {
  margin-top: 6px;
  padding: 8px 10px;
  background: #f7f8fb;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.answer .meta {
  color: #999;
  font-size: 11px;
}
.answer-row,
.ask-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.ask-row {
  margin-top: 0;
}
.answer-row input,
.ask-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.answer-row button,
.ask-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.answer-row button:disabled,
.ask-row button:disabled {
  opacity: 0.6;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
.notice {
  color: #1f9254;
  font-size: 13px;
}
</style>
