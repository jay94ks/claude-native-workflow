<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { useEntityPickerStore } from "../stores/entityPicker";
import { useAuthStore } from "../stores/auth";
import { nextDialogZIndex } from "../dialogZIndex";
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
const auth = useAuthStore();

// KanbanCardDialog/TargetPanelDialog를 통해 열리면 ProjectShellView의
// provide 트리 밖이라 inject를 못 쓴다 - DocumentExplorer.vue와 같은
// 이유로 직접 한 번 더 가볍게 조회한다. 질문 등록/답변/승인·거부/AI
// 확인 완료 표시는 전부 백엔드 requireEditorForTarget(editor 이상)과
// 같은 기준.
const canAnswer = ref(false);
async function loadMyRole() {
  try {
    const project = await apiCall<{ myRole: string | null }>(`/projects/${props.projectId}`);
    canAnswer.value = project.myRole === "owner" || project.myRole === "editor";
  } catch {
    canAnswer.value = false;
  }
}

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
const withdrawing = ref<Record<string, boolean>>({});
const transitionNotice = ref("");
const openOptionsFor = ref<string | null>(null);
const optionsZIndex = ref(1100);

const STATUS_LABEL: Record<string, string> = { open: "미답변", pending: "확인 대기", resolved: "처리 완료", withdrawn: "철회됨" };
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

function canWithdraw(q: QuestionItem): boolean {
  return q.status === "open" && (q.askedBy === auth.me?.id || !!auth.me?.isSuperAdmin);
}

async function withdraw(q: QuestionItem) {
  withdrawing.value = { ...withdrawing.value, [q.trackingCode]: true };
  error.value = "";
  try {
    await apiCall(`/questions/${q.trackingCode}/withdraw`, { method: "POST" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "철회에 실패했습니다";
  } finally {
    withdrawing.value = { ...withdrawing.value, [q.trackingCode]: false };
  }
}

onMounted(async () => {
  await loadMyRole();
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
          <button v-if="canWithdraw(q)" class="withdraw-btn" :disabled="withdrawing[q.trackingCode]" @click="withdraw(q)">
            철회
          </button>
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
            <button type="button" class="options-toggle" @click="optionsZIndex = nextDialogZIndex(); openOptionsFor = q.trackingCode">
              제안 목록 ({{ q.options.length }})
            </button>
            <div v-if="openOptionsFor === q.trackingCode" class="options-overlay" :style="{ zIndex: optionsZIndex }" @click.self="openOptionsFor = null">
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
          <button v-if="q.status === 'pending' && canAnswer" class="ack-btn" :disabled="acking[q.trackingCode]" @click="ack(q)">
            AI 확인 완료로 표시
          </button>
        </div>
        <template v-else-if="q.kind === 'approval'">
          <div v-if="canAnswer" class="approval-row">
            <textarea v-model="answerDrafts[q.trackingCode]" rows="2" placeholder="메모(선택, 여러 줄 입력 가능)"></textarea>
            <div class="approval-actions">
              <button type="button" class="approve" :disabled="answering[q.trackingCode]" @click="decide(q, 'approved')">승인</button>
              <button type="button" class="reject" :disabled="answering[q.trackingCode]" @click="decide(q, 'rejected')">거부</button>
            </div>
          </div>
        </template>
        <form v-else-if="canAnswer" class="answer-row" @submit.prevent="answer(q)">
          <textarea v-model="answerDrafts[q.trackingCode]" rows="2" placeholder="답변 입력... (여러 줄 입력 가능)"></textarea>
          <button type="submit" :disabled="answering[q.trackingCode]">답변</button>
        </form>
      </li>
      <li v-if="questions.length === 0" class="muted">아직 질문이 없습니다.</li>
    </ul>
    <Pagination :page="page" :total-pages="totalPages" @update:page="goToPage" />
    <form v-if="canAnswer" class="ask-row" @submit.prevent="askQuestion">
      <textarea v-model="newQuestion" rows="2" placeholder="새 질문 등록... (여러 줄 입력 가능)"></textarea>
      <div class="ask-controls">
        <select v-model="newKind">
          <option value="answer">답변 요청</option>
          <option value="approval">승인 요청</option>
        </select>
        <button type="button" class="refs-btn" @click="pickRefs">근거 문서 ({{ newRefs.length }})</button>
        <button type="submit" :disabled="asking">질문 등록</button>
      </div>
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
  color: var(--color-text-faint);
  margin: 0 0 10px;
}
.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 10px;
  background: var(--color-surface);
  color: var(--color-text);
}
.questions {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.questions li {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-light);
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
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-purple-bg);
  color: var(--color-purple-text);
  flex-shrink: 0;
}
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.status.resolved {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.status.pending {
  background: var(--color-tcode-hover-bg);
  color: var(--color-primary);
}
.status.open {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}
.status.withdrawn {
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
}
.text {
  flex: 1;
}
.q-meta {
  font-size: 11px;
  color: var(--color-text-faint);
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
  background: var(--color-bg);
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
  background: var(--color-success-bg);
  color: var(--color-success);
}
.decision.rejected {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}
.answer .meta {
  color: var(--color-text-faint);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.options-toggle {
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
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
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-btn:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-primary);
}
.option-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.option-detail {
  font-size: 11px;
  color: var(--color-text-muted);
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
  background: var(--color-surface);
  color: var(--color-text);
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
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.ack-btn {
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
}
.withdraw-btn {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-danger);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  flex-shrink: 0;
}
.answer-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  align-items: flex-start;
}
.ask-row,
.approval-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}
.ask-row {
  margin-top: 0;
}
.answer-row textarea,
.ask-row textarea,
.approval-row textarea {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  min-width: 100px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
}
.ask-controls,
.approval-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ask-controls select {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.refs-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.answer-row button,
.ask-controls button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.answer-row button:disabled,
.ask-controls button:disabled {
  opacity: 0.6;
}
.approval-actions .approve {
  background: var(--color-success);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.approval-actions .reject {
  background: var(--color-danger);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.approval-actions button:disabled {
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
.notice {
  color: var(--color-success);
  font-size: 13px;
}
</style>
