<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import UserRef from "./UserRef.vue";
import TrackingCodeText from "./TrackingCodeText.vue";

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
  askedBy: string;
  status: string; // open | pending | resolved
  refs: string[];
  answer: AnswerDetail | null;
}

const questions = ref<QuestionItem[]>([]);
const loading = ref(true);
const error = ref("");

const newQuestion = ref("");
const newRefs = ref("");
const asking = ref(false);

const answerDrafts = ref<Record<string, string>>({});
const answering = ref<Record<string, boolean>>({});
const acking = ref<Record<string, boolean>>({});
const transitionNotice = ref("");

const STATUS_LABEL: Record<string, string> = { open: "미답변", pending: "확인 대기", resolved: "처리 완료" };

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
      body: JSON.stringify({
        text: newQuestion.value.trim(),
        refs: newRefs.value ? newRefs.value.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      }),
    });
    newQuestion.value = "";
    newRefs.value = "";
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

async function ack(q: QuestionItem) {
  acking.value = { ...acking.value, [q.trackingCode]: true };
  error.value = "";
  try {
    await apiCall(`/questions/${q.trackingCode}/ack`, { method: "POST" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "확인 처리에 실패했습니다";
  } finally {
    acking.value = { ...acking.value, [q.trackingCode]: false };
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
    <p class="hint">질의는 AI(클로드)가 등록하고, 설계자가 답변한다.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="transitionNotice" class="notice">{{ transitionNotice }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="questions">
      <li v-for="q in questions" :key="q.trackingCode">
        <div class="q-row">
          <code>{{ q.trackingCode }}</code>
          <span class="status" :class="q.status">{{ STATUS_LABEL[q.status] ?? q.status }}</span>
          <span class="text"><TrackingCodeText :text="q.text" /></span>
        </div>
        <div class="q-meta">
          질의자 <UserRef :user-id="q.askedBy" />
          <template v-if="q.refs.length > 0">
            · 참고:
            <TrackingCodeText v-for="ref in q.refs" :key="ref" :text="ref" class="ref-chip" />
          </template>
        </div>
        <div v-if="q.answer" class="answer">
          <span class="body"><TrackingCodeText :text="q.answer.body" /></span>
          <span class="meta"><UserRef :user-id="q.answer.answeredBy" /> · {{ new Date(q.answer.answeredAt).toLocaleString() }}</span>
          <button v-if="q.status === 'pending'" class="ack-btn" :disabled="acking[q.trackingCode]" @click="ack(q)">
            AI 확인 완료로 표시
          </button>
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
      <input v-model="newRefs" type="text" placeholder="참고 문서 코드(쉼표 구분, 선택)" class="refs-input" />
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
  margin: 0 0 4px;
}
.hint {
  font-size: 12px;
  color: #999;
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
.status.resolved {
  background: #e3f6ec;
  color: #1f9254;
}
.status.pending {
  background: #e4e9fb;
  color: #3454d1;
}
.status.open {
  background: #fdf0e3;
  color: #b96a1a;
}
.text {
  flex: 1;
}
.q-meta {
  font-size: 11px;
  color: #999;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.ref-chip {
  margin-right: 2px;
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
  align-items: flex-start;
}
.answer .meta {
  color: #999;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.ack-btn {
  background: #fff;
  border: 1px solid #3454d1;
  color: #3454d1;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
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
.refs-input {
  flex: 1;
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
