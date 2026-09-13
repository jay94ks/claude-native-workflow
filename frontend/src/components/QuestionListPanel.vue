<script setup lang="ts">
// "문서" 탭의 "답변 대기"/"답변 기록" 서브탭이 공유하는 질의 목록
// (#document-answer-status-subtabs) - DocumentListPanel.vue와 같은
// 패턴(데이터 소스는 부모가 fetch, 이 컴포넌트는 결과만 받아 표시).
// 추적코드를 누르면 QuestionDialog(읽기 전용 미리보기)가 뜬다 -
// 실제 답변/승인은 거기서 "대상 열기"로 넘어간 원본 문서/카드에서.
import { useQuestionDialogStore } from "../stores/questionDialog";

interface QuestionSummary {
  trackingCode: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  kind: string;
  text: string;
  status: string;
}

const props = defineProps<{
  items: QuestionSummary[];
  page: number;
  totalPages: number;
  total: number;
  loading: boolean;
  error: string;
  emptyText: string;
}>();
const emit = defineEmits<{ "page-change": [page: number] }>();

const dialog = useQuestionDialogStore();

const KIND_LABEL: Record<string, string> = { answer: "답변 요청", approval: "승인 요청" };
const STATUS_LABEL: Record<string, string> = { open: "미답변", pending: "확인 대기", resolved: "처리 완료" };
</script>

<template>
  <div class="panel">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else>
      <ul class="list">
        <li v-for="q in items" :key="q.trackingCode">
          <div class="main">
            <code class="tcode" @click="dialog.show(q.trackingCode)">{{ q.trackingCode }}</code>
            <span class="kind">{{ KIND_LABEL[q.kind] ?? q.kind }}</span>
            <span class="text">{{ q.text }}</span>
          </div>
          <span class="right">
            <span class="muted">{{ q.targetLabel }}</span>
            <span class="status" :class="q.status">{{ STATUS_LABEL[q.status] ?? q.status }}</span>
          </span>
        </li>
        <li v-if="items.length === 0" class="muted empty">{{ emptyText }}</li>
      </ul>
      <div v-if="totalPages > 1" class="pagination">
        <button type="button" :disabled="page <= 1" @click="emit('page-change', page - 1)">이전</button>
        <span class="page-indicator">{{ page }} / {{ totalPages }} (총 {{ total }}건)</span>
        <button type="button" :disabled="page >= totalPages" @click="emit('page-change', page + 1)">다음</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  flex: 1;
  min-width: 0;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.tcode {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-primary);
  cursor: pointer;
  flex-shrink: 0;
}
.tcode:hover {
  background: var(--color-tcode-hover-bg);
}
.kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-purple-bg);
  color: var(--color-purple-text);
  flex-shrink: 0;
}
.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
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
.list .empty {
  padding: 12px 16px;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}
.pagination button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.pagination button:disabled {
  opacity: 0.4;
}
.page-indicator {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
  white-space: nowrap;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
