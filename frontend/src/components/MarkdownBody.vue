<script setup lang="ts">
import { computed, ref } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useDocumentDialogStore } from "../stores/documentDialog";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";

const props = defineProps<{ body: string }>();
const dialog = useDocumentDialogStore();
const kanbanDialog = useKanbanCardDialogStore();
const container = ref<HTMLElement | null>(null);

const TRACKING_CODE_RE = /\b([A-Z]{2}-[0-9A-F]{8})\b/g;

// marked → HTML → DOMPurify로 새니타이즈(XSS 방지 - 문서 본문은 다른
// 설계자/AI가 입력한 신뢰 못 할 텍스트일 수 있음) → 그 결과 HTML
// 문자열에서 추적 코드 패턴을 찾아 클릭 가능한 span으로 감싸는 후처리
// 정규식 치환 한 번(코드 블록 안의 우연한 패턴도 링크화될 수 있는 건
// 알려진 사소한 예외 - 이번 범위에서 AST 레벨 처리는 안 함).
const html = computed(() => {
  const rawHtml = marked.parse(props.body || "", { async: false }) as string;
  const clean = DOMPurify.sanitize(rawHtml);
  return clean.replace(TRACKING_CODE_RE, '<span class="tcode-link" data-code="$1">$1</span>');
});

function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const codeEl = target.closest(".tcode-link") as HTMLElement | null;
  const code = codeEl?.dataset.code;
  if (!code) return;
  if (code.startsWith("KB-")) kanbanDialog.show(code);
  else dialog.show(code);
}
</script>

<template>
  <div ref="container" class="markdown-body" @click="onClick" v-html="html"></div>
</template>

<style scoped>
.markdown-body {
  line-height: 1.6;
  font-size: 14px;
  word-break: break-word;
}
.markdown-body :deep(.tcode-link) {
  background: var(--color-surface-hover);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-primary);
  cursor: pointer;
  font-family: monospace;
}
.markdown-body :deep(.tcode-link:hover) {
  background: var(--color-tcode-hover-bg);
}
.markdown-body :deep(pre) {
  background: var(--color-bg);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
}
.markdown-body :deep(code) {
  font-family: "SFMono-Regular", Consolas, monospace;
}
.markdown-body :deep(img) {
  max-width: 100%;
}
.markdown-body :deep(table) {
  border-collapse: collapse;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--color-border);
  padding: 4px 8px;
}
</style>
