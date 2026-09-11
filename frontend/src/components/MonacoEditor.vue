<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { monaco } from "../monaco-setup";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    readOnly?: boolean;
  }>(),
  { language: "plaintext", readOnly: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const containerRef = ref<HTMLDivElement>();
const editor = shallowRef<ReturnType<typeof monaco.editor.create>>();

onMounted(() => {
  if (!containerRef.value) return;
  const instance = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: props.language,
    readOnly: props.readOnly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
  });
  instance.onDidChangeModelContent(() => {
    emit("update:modelValue", instance.getValue());
  });
  editor.value = instance;
});

onBeforeUnmount(() => {
  editor.value?.dispose();
});

// 외부에서 modelValue가 바뀌면(예: 다른 파일을 열었을 때) 에디터 내용도
// 맞춘다 - 단, 에디터 자신의 입력으로 인한 emit 순환은 getValue()와
// 비교해 건너뛴다.
watch(
  () => props.modelValue,
  (value) => {
    if (editor.value && editor.value.getValue() !== value) {
      editor.value.setValue(value);
    }
  },
);

watch(
  () => props.language,
  (language) => {
    const model = editor.value?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
  },
);

watch(
  () => props.readOnly,
  (readOnly) => {
    editor.value?.updateOptions({ readOnly });
  },
);
</script>

<template>
  <div ref="containerRef" class="monaco-container" />
</template>

<style scoped>
.monaco-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  overflow: hidden;
}
</style>
