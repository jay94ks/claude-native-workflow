<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { monaco } from "../monaco-setup";
import { useThemeStore } from "../stores/theme";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    readOnly?: boolean;
  }>(),
  { language: "plaintext", readOnly: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const theme = useThemeStore();

const containerRef = ref<HTMLDivElement>();
const editor = shallowRef<ReturnType<typeof monaco.editor.create>>();

// Monaco는 캔버스에 직접 그리는 위젯이라 페이지의 CSS 다크 모드를
// 저절로 따라가지 않는다 - JS로 명시적으로 테마를 지정해야 한다
// (#responsive-dark-mode). monaco.editor.setTheme()은 프로세스 전역
// 설정이라(인스턴스별 아님) 이 앱처럼 한 번에 에디터 인스턴스가 하나뿐인
// 구조에선 그대로 전역 호출해도 문제없다.
function applyMonacoTheme(): void {
  monaco.editor.setTheme(theme.resolved === "dark" ? "vs-dark" : "vs");
}

onMounted(() => {
  if (!containerRef.value) return;
  applyMonacoTheme();
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

watch(() => theme.resolved, applyMonacoTheme);

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
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}
</style>
