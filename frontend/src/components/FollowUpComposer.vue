<template>
  <div>
    <div v-if="!openKind" class="row justify-end q-gutter-sm q-mt-sm">
      <q-btn size="sm" outline color="primary" icon="help" :label="askLabel" @click="open('question')" />
      <q-btn size="sm" outline color="teal" icon="chat" :label="opinionLabel" @click="open('opinion')" />
    </div>
    <q-slide-transition>
      <div v-if="openKind" class="q-mt-sm">
        <div class="text-subtitle2 q-mb-sm">{{ openKind === "question" ? askLabel : opinionLabel }}</div>
        <q-input v-model="title" label="제목" dense class="q-mb-sm" />
        <MarkdownSourceView ref="editorRef" content="" start-in-edit hide-toolbar :edit-min-height="200" />
        <div v-if="error" class="text-negative text-caption q-mt-xs">{{ error }}</div>
        <div class="row justify-end q-gutter-sm q-mt-sm">
          <q-btn flat label="취소하기" @click="close" />
          <q-btn color="primary" label="등록하기" :loading="submitting" @click="submit" />
        </div>
      </div>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
// design-notes.md "항목별 추가 질문/추가 의견" - question/opinion은 부모
// 타입 제한이 없어(documentRules.ts) 어떤 항목(문서 자신/질문/답변/의견)
// 에도 자유롭게 달 수 있다. 이 위젯 하나로 그 다섯 군데(문서 전체 레벨의
// "질문하기"/"의견 남기기" 포함) 전부를 커버한다 - v-for 루프 안에 이
// 컴포넌트를 여러 개 두어도 각 인스턴스가 자기 자신의 MarkdownSourceView
// ref를 갖게 되므로(DocumentDiscussion.vue가 이전에 겪었던 "v-for 안의
// 동일 이름 ref가 배열로 묶이는" 문제 자체가 이 추출로 사라진다), 부모가
// 항목별 컴포저 상태를 따로 관리할 필요가 없다.
import { ref } from "vue";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import * as api from "src/api/client";

interface MarkdownSourceViewRef {
  getMarkdown(): string;
}

const props = withDefaults(
  defineProps<{
    owner: string;
    projectId: string;
    parentCode: string;
    askLabel?: string;
    opinionLabel?: string;
  }>(),
  { askLabel: "추가 질문", opinionLabel: "추가 의견" }
);
const emit = defineEmits<{ created: [] }>();
const auth = useAuthStore();

const openKind = ref<"question" | "opinion" | null>(null);
const title = ref("");
const editorRef = ref<MarkdownSourceViewRef | null>(null);
const submitting = ref(false);
const error = ref("");

function open(kind: "question" | "opinion") {
  openKind.value = kind;
  title.value = "";
  error.value = "";
}
function close() {
  openKind.value = null;
}

async function submit() {
  if (!openKind.value) return;
  submitting.value = true;
  error.value = "";
  const isQuestion = openKind.value === "question";
  const result = await api.createDocument(auth.apiKey!, props.owner, props.projectId, {
    type: isQuestion ? "question" : "opinion",
    kind: isQuestion ? "QU" : "OP",
    parentId: props.parentCode,
    title: title.value,
    content: editorRef.value?.getMarkdown() ?? "",
  });
  submitting.value = false;
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  openKind.value = null;
  emit("created");
}
</script>
