<script setup lang="ts">
import { watch, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useQuestionDialogStore } from "../stores/questionDialog";
import { useDocumentDialogStore } from "../stores/documentDialog";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";
import { usePlanDialogStore } from "../stores/planDialog";
import { nextDialogZIndex } from "../dialogZIndex";
import UserRef from "./UserRef.vue";
import TrackingCodeText from "./TrackingCodeText.vue";

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
interface QuestionDetail {
  trackingCode: string;
  projectId: string;
  targetType: "document" | "source" | "kanbanCard" | "plan";
  targetKey: string;
  kind: string; // answer | approval
  text: string;
  askedBy: string;
  status: string; // open | pending | resolved | withdrawn
  refs: string[];
  options: QuestionOptionItem[];
  answer: AnswerDetail | null;
}

const dialog = useQuestionDialogStore();
const documentDialog = useDocumentDialogStore();
const kanbanDialog = useKanbanCardDialogStore();
const planDialog = usePlanDialogStore();
const question = ref<QuestionDetail | null>(null);
const loading = ref(false);
const error = ref("");
const zIndex = ref(1000);

const STATUS_LABEL: Record<string, string> = { open: "미답변", pending: "확인 대기", resolved: "처리 완료", withdrawn: "철회됨" };
const KIND_LABEL: Record<string, string> = { answer: "답변 요청", approval: "승인 요청" };

watch(
  () => dialog.open,
  (open) => {
    if (open) zIndex.value = nextDialogZIndex();
  },
);

watch(
  () => [dialog.open, dialog.trackingCode],
  async () => {
    if (!dialog.open || !dialog.trackingCode) return;
    question.value = null;
    error.value = "";
    loading.value = true;
    try {
      question.value = await apiCall<QuestionDetail>(`/questions/${dialog.trackingCode}`);
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "질의를 불러오지 못했습니다";
    } finally {
      loading.value = false;
    }
  },
);

function openTarget(): void {
  if (!question.value) return;
  if (question.value.targetType === "document") documentDialog.show(question.value.targetKey);
  else if (question.value.targetType === "kanbanCard") kanbanDialog.show(question.value.targetKey);
  else if (question.value.targetType === "plan") planDialog.show(question.value.targetKey);
  // targetType "source"는 별도 미리보기 다이얼로그가 없어 생략(소스
  // 코드 화면으로 직접 이동해야 함 - 이 다이얼로그의 범위 밖).
}
</script>

<template>
  <div v-if="dialog.open" class="overlay" :style="{ zIndex }" @click.self="dialog.close()">
    <div class="dialog">
      <button class="close-btn" @click="dialog.close()">닫기 ✕</button>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="question">
        <div class="header">
          <code>{{ question.trackingCode }}</code>
          <span class="kind">{{ KIND_LABEL[question.kind] ?? question.kind }}</span>
          <span class="status" :class="question.status">{{ STATUS_LABEL[question.status] ?? question.status }}</span>
        </div>
        <p class="text"><TrackingCodeText :text="question.text" /></p>
        <div class="meta">
          질의자 <UserRef :user-id="question.askedBy" />
          <template v-if="question.targetType !== 'source'">
            · <button type="button" class="link-btn" @click="openTarget">대상 열기 ({{ question.targetKey }})</button>
          </template>
          <template v-else> · 대상 소스: {{ question.targetKey }}</template>
        </div>

        <section v-if="question.refs.length > 0" class="section">
          <h3>참고 문서</h3>
          <ul class="ref-list">
            <li v-for="ref in question.refs" :key="ref">
              <code class="ref-code" @click="documentDialog.show(ref)">{{ ref }}</code>
            </li>
          </ul>
        </section>

        <section v-if="!question.answer && question.options.length > 0" class="section">
          <h3>제안 선택지</h3>
          <ul class="options-list">
            <li v-for="(opt, i) in question.options" :key="i">
              <span class="option-label">{{ opt.label }}</span>
              <span v-if="opt.detail" class="option-detail">{{ opt.detail }}</span>
            </li>
          </ul>
        </section>

        <section v-if="question.answer" class="section answer">
          <h3>답변</h3>
          <span v-if="question.answer.decision" class="decision" :class="question.answer.decision">
            {{ question.answer.decision === "approved" ? "승인됨" : "거부됨" }}
          </span>
          <p v-if="question.answer.body" class="answer-body"><TrackingCodeText :text="question.answer.body" /></p>
          <span class="answer-meta">
            <UserRef :user-id="question.answer.answeredBy" /> · {{ new Date(question.answer.answeredAt).toLocaleString() }}
          </span>
        </section>
        <p v-else class="muted">아직 답변되지 않았습니다.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 10px;
  padding: 24px;
  width: min(640px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.header code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
.kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-purple-bg);
  color: var(--color-purple-text);
}
.status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
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
  font-size: 14px;
  margin: 0 0 10px;
}
.meta {
  font-size: 12px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
}
.section {
  margin-bottom: 16px;
}
.section h3 {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 6px;
}
.ref-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ref-code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-primary);
  cursor: pointer;
}
.ref-code:hover {
  background: var(--color-tcode-hover-bg);
}
.options-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.options-list li {
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  border-radius: 6px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-label {
  font-size: 13px;
  font-weight: 600;
}
.option-detail {
  font-size: 11px;
  color: var(--color-text-muted);
}
.answer {
  padding: 10px;
  background: var(--color-bg);
  border-radius: 6px;
}
.decision {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
  display: inline-block;
  margin-bottom: 6px;
}
.decision.approved {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.decision.rejected {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}
.answer-body {
  font-size: 13px;
  margin: 0 0 6px;
}
.answer-meta {
  font-size: 11px;
  color: var(--color-text-faint);
  display: flex;
  align-items: center;
  gap: 4px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
}
</style>
