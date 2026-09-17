<script setup lang="ts">
// 모달 오버레이 공통 껍데기 - 12개 다이얼로그 컴포넌트가 각자 손으로
// 구현하던 "배경 오버레이 + 중앙 정렬 패널 + z-index 관리"를 여기로
// 모았다(#frontend-shared-modal, BL-57F8DF17 #69). 내용(헤더/닫기
// 버튼/본문)은 그대로 각 다이얼로그 컴포넌트가 slot으로 채운다 - 이
// 컴포넌트는 오버레이 자체의 뼈대와 nextDialogZIndex() 관리만 맡는다.
import { ref, watch } from "vue";
import { nextDialogZIndex } from "../dialogZIndex";

const props = withDefaults(defineProps<{ open: boolean; width?: number }>(), { width: 640 });
const emit = defineEmits<{ close: [] }>();

const zIndex = ref(1000);

watch(
  () => props.open,
  (open) => {
    if (open) zIndex.value = nextDialogZIndex();
  },
);
</script>

<template>
  <div v-if="open" class="overlay" :style="{ zIndex }" @click.self="emit('close')">
    <div class="dialog" :style="{ width: `min(${width}px, 90vw)` }">
      <slot />
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
}
.dialog {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 10px;
  padding: 24px;
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
</style>
