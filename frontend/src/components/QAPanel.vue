<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { useEntityPickerStore } from "../stores/entityPicker";
import UserRef from "./UserRef.vue";
import TrackingCodeText from "./TrackingCodeText.vue";
import Pagination from "./Pagination.vue";

const props = withDefaults(
  defineProps<{
    projectId: string;
    targetType: "document" | "source" | "kanbanCard";
    targetKey: string;
    /** 이미 다이얼로그 안(TargetPanelDialog/KanbanCardDialog)이면 true -
     * 선택지를 그 자리에 바로 보여준다. 페이지에 직접 박혀있으면(문서
     * [질의/답변] 탭) false - "제안 목록" 버튼 뒤 별도 다이얼로그로. */
    inDialog?: boolean;
  }>(),
  { inDialog: false },
);
const emit = defineEmits<{ statusTransitioned: [statusCode: string] }>();

const entityPicker = useEntityPickerStore();

interface AnswerDetail {
  body: string | null;
  decision: string | null;
  answeredBy: string;
  answeredAt: string;
}
interface QuestionOptionItem {
  label: string;
  detail: string | null;
}
interface QuestionItem {
  trackingCode: string;
  ordinal: number;
  kind: string; // approval | answer
  text: string;
  askedBy: string;
  status: string; // open | pending | resolved
  refs: string[];
  options: QuestionOptionItem[];
  answer: AnswerDetail | null;
}

interface QuestionPageResponse {
  items: QuestionItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const questions = ref<QuestionItem[]>([]);
const loading = ref(true);
const error = ref("");
const page = ref(1);
const totalPages = ref(1);
const pageSize = 20;
const searchQuery = ref("");
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const newQuestion = ref("");
const newKind = ref<"answer" | "approval">("answer");
const newRefs = ref<string[]>([]);
const asking = ref(false);

const answerDrafts = ref<Record<string, string>>({});
const answering = ref<Record<string, boolean>>({});
const acking = ref<Record<string, boolean>>({});
const transitionNotice = ref("");
const openOptionsFor = ref<string | null>(null);

const STATUS_LABEL: Record<string, string> = { open: "미답변", pending: "확인 대기", resolved: "처리 완료" };
const KIND_LABEL: Record<string, string> = { answer: "답변 요청", approval: "승인 요청" };

let disconnect: (() => void) | null = null;

const listPath = () => {
  const qs = new URLSearchParams();
  qs.set("page", String(page.value));
  qs.set("pageSize", String(pageSize));
  if (searchQuery.value.trim()) qs.set("q", searchQuery.value.trim());
  if (props.targetType === "source") {
    qs.set("path", props.targetKey);
    return `/projects/${props.projectId}/questions/source/page?${qs}`;
  }
  qs.set("trackingCode", props.targetKey);
  return `/questions/page?${qs}`;
};

const createPath = () => (props.targetType === "source" ? `/projects/${props.projectId}/questions/source` : `/questions`);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await apiCall<QuestionPageResponse>(listPath());
    questions.value = result.items;
    page.value = result.page;
    totalPages.value = result.totalPages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "질문을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onSearchInput() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
}

function goToPage(p: number) {
  page.value = p;
  load();
}

async function pickRefs() {
  const result = await entityPicker.pick({
    kind: "document",
    projectId: props.projectId,
    multi: true,
    allowManualEntry: false,
    initialSelected: newRefs.value,
  });
  if (result) newRefs.value = result;
}

async function askQuestion() {
  if (!newQuestion.value.trim()) return;
  asking.value = true;
  error.value = "";
  try {
    const body: Record<string, unknown> = {
      kind: newKind.value,
      text: newQuestion.value.trim(),
      refs: newRefs.value.length > 0 ? newRefs.value : undefined,
    };
    if (props.targetType === "source") body.path = props.targetKey;
    else body.trackingCode = props.targetKey;
    await apiCall(createPath(), { method: "POST", body: JSON.stringify(body) });
    newQuestion.value = "";
    newRefs.value = [];
    page.value = 1;
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
  await submitAnswer(q, { body });
}

async function decide(q: QuestionItem, decision: "approved" | "rejected") {
  const note = (answerDrafts.value[q.trackingCode] ?? "").trim();
  await submitAnswer(q, { decision, body: note || undefined });
}

async function submitAnswer(q: QuestionItem, payload: { body?: string; decision?: string }) {
  answering.value = { ...answering.value, [q.trackingCode]: true };
  error.value = "";
  transitionNotice.value = "";
  try {
    const result = await apiCall<{ documentStatusTransitioned: string | null }>(`/questions/${q.trackingCode}/answer`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
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

/** 선택지 클릭 - 제출은 안 하고 수동 입력칸(답변/승인메모 공용)만
 * 채운다(검토 후 기존 답변/승인/거부 버튼으로 직접 제출). */
function selectOption(q: QuestionItem, option: QuestionOptionItem) {
  answerDrafts.value = { ...answerDrafts.value, [q.trackingCode]: option.label };
  if (openOptionsFor.value === q.trackingCode) openOptionsFor.value = null;
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
      if (
        (event.entity === "question" || event.entity === "answer") &&
        (!event.targetType || (event.targetType === props.targetType && event.targetKey === props.targetKey))
      ) {
        load();
      }
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section class="panel">
    <h2>질의/답변</h2>
    <p class="hint">질의는 AI(클로드)가 등록하고, 설계자가 답변한다. 최신순으로 표시된다.</p>
    <input
      v-model="searchQuery"
      type="text"
      class="search-input"
      placeholder="질의/답변 내용 검색..."
      @input="onSearchInput"
    />
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="transitionNotice" class="notice">{{ transitionNotice }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="questions">
      <li v-for="q in questions" :key="q.trackingCode">
        <div class="q-row">
          <code>{{ q.trackingCode }}</code>
          <span class="kind">{{ KIND_LABEL[q.kind] ?? q.kind }}</span>
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
        <template v-if="!q.answer && q.options.length > 0">
          <!-- inDialog: 이미 다이얼로그 안이라 바로 목록으로 노출 -->
          <ul v-if="inDialog" class="options-list">
            <li v-for="(opt, i) in q.options" :key="i">
              <button type="button" class="option-btn" @click="selectOption(q, opt)">
                <span class="option-label">{{ opt.label }}</span>
                <span v-if="opt.detail" class="option-detail">{{ opt.detail }}</span>
              </button>
            </li>
          </ul>
          <!-- 페이지에 직접 박힌 경우: 버튼 뒤 별도 다이얼로그로 -->
          <template v-else>
            <button type="button" class="options-toggle" @click="openOptionsFor = q.trackingCode">
              제안 목록 ({{ q.options.length }})
            </button>
            <div v-if="openOptionsFor === q.trackingCode" class="options-overlay" @click.self="openOptionsFor = null">
              <div class="options-dialog">
                <button type="button" class="close-btn" @click="openOptionsFor = null">닫기 ✕</button>
                <ul class="options-list">
                  <li v-for="(opt, i) in q.options" :key="i">
                    <button type="button" class="option-btn" @click="selectOption(q, opt)">
                      <span class="option-label">{{ opt.label }}</span>
                      <span v-if="opt.detail" class="option-detail">{{ opt.detail }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </template>
        </template>
        <div v-if="q.answer" class="answer">
          <span v-if="q.answer.decision" class="decision" :class="q.answer.decision">
            {{ q.answer.decision === "approved" ? "승인됨" : "거부됨" }}
          </span>
          <span v-if="q.answer.body" class="body"><TrackingCodeText :text="q.answer.body" /></span>
          <span class="meta"><UserRef :user-id="q.answer.answeredBy" /> · {{ new Date(q.answer.answeredAt).toLocaleString() }}</span>
          <button v-if="q.status === 'pending'" class="ack-btn" :disabled="acking[q.trackingCode]" @click="ack(q)">
            AI 확인 완료로 표시
          </button>
        </div>
        <template v-else-if="q.kind === 'approval'">
          <div class="approval-row">
            <input v-model="answerDrafts[q.trackingCode]" type="text" placeholder="메모(선택)" />
            <button type="button" class="approve" :disabled="answering[q.trackingCode]" @click="decide(q, 'approved')">승인</button>
            <button type="button" class="reject" :disabled="answering[q.trackingCode]" @click="decide(q, 'rejected')">거부</button>
          </div>
        </template>
        <form v-else class="answer-row" @submit.prevent="answer(q)">
          <input v-model="answerDrafts[q.trackingCode]" type="text" placeholder="답변 입력..." />
          <button type="submit" :disabled="answering[q.trackingCode]">답변</button>
        </form>
      </li>
      <li v-if="questions.length === 0" class="muted">아직 질문이 없습니다.</li>
    </ul>
    <Pagination :page="page" :total-pages="totalPages" @update:page="goToPage" />
    <form class="ask-row" @submit.prevent="askQuestion">
      <input v-model="newQuestion" type="text" placeholder="새 질문 등록..." />
      <select v-model="newKind">
        <option value="answer">답변 요청</option>
        <option value="approval">승인 요청</option>
      </select>
      <button type="button" class="refs-btn" @click="pickRefs">근거 문서 ({{ newRefs.length }})</button>
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
.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 10px;
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
  flex-wrap: wrap;
}
.q-row code {
  font-size: 11px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f0e9fb;
  color: #6a3ea1;
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
.decision {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.decision.approved {
  background: #e3f6ec;
  color: #1f9254;
}
.decision.rejected {
  background: #fbe4e8;
  color: #d1344b;
}
.answer .meta {
  color: #999;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.options-toggle {
  background: #fff;
  border: 1px solid #3454d1;
  color: #3454d1;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-top: 4px;
}
.options-list {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.option-btn {
  width: 100%;
  text-align: left;
  background: #f7f8fb;
  border: 1px solid #e4e6ee;
  border-radius: 6px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-btn:hover {
  background: #eef0f6;
  border-color: #3454d1;
}
.option-label {
  font-size: 13px;
  font-weight: 600;
  color: #222;
}
.option-detail {
  font-size: 11px;
  color: #888;
}
.options-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.options-dialog {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: min(420px, 90vw);
  max-height: 70vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.options-dialog .close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
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
.ask-row,
.approval-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.ask-row {
  margin-top: 0;
}
.answer-row input,
.ask-row input,
.approval-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  min-width: 100px;
}
.ask-row select {
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.refs-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
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
.approval-row .approve {
  background: #1f9254;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.approval-row .reject {
  background: #d1344b;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.approval-row button:disabled {
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
