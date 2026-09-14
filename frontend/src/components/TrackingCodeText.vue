<script setup lang="ts">
import { computed } from "vue";
import { useDocumentDialogStore } from "../stores/documentDialog";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";
import { useQuestionDialogStore } from "../stores/questionDialog";
import { usePlanDialogStore } from "../stores/planDialog";

const props = defineProps<{ text: string }>();
const dialog = useDocumentDialogStore();
const kanbanDialog = useKanbanCardDialogStore();
const questionDialog = useQuestionDialogStore();
const planDialog = usePlanDialogStore();

const TRACKING_CODE_RE = /\b[A-Z]{2}-[0-9A-F]{8}\b/g;

// "QU"/"KB"/"PN"은 문서 분류 코드로 못 쓰게 예약돼 있어(docTypes.ts의
// RESERVED_DOC_TYPE_CODES) 항상 질의/칸반 카드/계획을 가리킨다고 믿고
// 분기할 수 있다(#reserved-tracking-codes).
function openCode(code: string): void {
  if (code.startsWith("KB-")) kanbanDialog.show(code);
  else if (code.startsWith("QU-")) questionDialog.show(code);
  else if (code.startsWith("PN-")) planDialog.show(code);
  else dialog.show(code);
}

interface Part {
  text: string;
  isCode: boolean;
}

const parts = computed<Part[]>(() => {
  const result: Part[] = [];
  let lastIndex = 0;
  for (const match of props.text.matchAll(TRACKING_CODE_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) result.push({ text: props.text.slice(lastIndex, index), isCode: false });
    result.push({ text: match[0], isCode: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < props.text.length) result.push({ text: props.text.slice(lastIndex), isCode: false });
  return result;
});
</script>

<template>
  <span
    ><template v-for="(part, i) in parts" :key="i"
      ><code v-if="part.isCode" class="tcode" @click="openCode(part.text)">{{ part.text }}</code
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>

<style scoped>
span {
  white-space: pre-wrap;
}
.tcode {
  white-space: normal;
  background: var(--color-surface-hover);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-primary);
  cursor: pointer;
}
.tcode:hover {
  background: var(--color-tcode-hover-bg);
}
</style>
