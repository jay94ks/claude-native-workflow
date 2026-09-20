<template>
  <div>
    <div v-if="!hideToolbar" class="row items-center justify-between q-mb-sm">
      <div class="text-caption" style="color: var(--gh-fg-muted)">{{ mode === "view" ? "View" : "Edit" }}</div>
      <div class="q-gutter-sm">
        <q-btn v-if="mode === 'view' && !readOnly" size="sm" flat dense icon="edit" label="편집" @click="enterEdit" />
        <template v-else-if="mode === 'edit'">
          <q-btn size="sm" flat dense label="취소" @click="cancelEdit" />
          <q-btn size="sm" color="primary" dense label="저장" :loading="saving" @click="doSave" />
        </template>
      </div>
    </div>

    <!-- yiitap(https://github.com/pileax-ai/yiitap) 기반 - 정본은 항상 Markdown 텍스트다(백엔드 content 필드).
         yiitap 자체엔 markdown<->content 프로그래매틱 변환 API가 없어서(클립보드 붙여넣기/복사에만 markdown
         지원) marked(md->html)/turndown(html->md)로 경계에서 직접 변환한다. editable=false일 때가 "보기
         모드"(마크다운을 HTML로 렌더링해서 보여주기만), editable=true가 "편집 모드". -->
    <YiiEditor
      v-if="mode === 'edit'"
      :key="'edit-' + editorKey"
      ref="editorRef"
      :content="htmlForEdit"
      editable
      show-bubble-menu
      show-side-menu
      page-view="page"
    />
    <YiiEditor
      v-else
      :key="'view-' + editorKey"
      :content="htmlForView"
      :editable="false"
      :show-bubble-menu="false"
      :show-floating-menu="false"
      :show-main-menu="false"
      :show-side-node="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { YiiEditor } from "@yiitap/vue";
import { marked } from "marked";
import TurndownService from "turndown";
import "@yiitap/vue/dist/vue.css";

const props = withDefaults(
  defineProps<{ content: string; readOnly?: boolean; startInEdit?: boolean; hideToolbar?: boolean }>(),
  { readOnly: false, startInEdit: false, hideToolbar: false }
);
const emit = defineEmits<{ save: [markdown: string]; cancel: [] }>();

const mode = ref<"view" | "edit">(props.startInEdit ? "edit" : "view");
const editorRef = ref<{ editor?: { value?: { getHTML(): string } } | { getHTML(): string } } | null>(null);
const editorKey = ref(0);
const saving = ref(false);

const htmlForView = computed(() => marked.parse(props.content || "*(빈 문서)*", { async: false }) as string);

// YiiEditor의 content prop은 "초기 내용"일 뿐이라 마운트 이후 반응형으로
// 다시 반영되지 않는다 - 저장 후 부모가 새 content를 내려줘도(비동기라
// 저장 시점 곧바로가 아니라 실제로 그 값이 바뀌는 시점에) view 모드가
// 예전 내용을 그대로 보여주는 버그가 있었다. content prop 자체의 변화를
// 지켜보다가 key를 바꿔 강제로 다시 마운트시킨다.
watch(
  () => props.content,
  () => {
    editorKey.value++;
  }
);
const htmlForEdit = ref(props.startInEdit ? (marked.parse(props.content || "", { async: false }) as string) : "");

function enterEdit() {
  htmlForEdit.value = marked.parse(props.content || "", { async: false }) as string;
  editorKey.value++;
  mode.value = "edit";
}

function cancelEdit() {
  mode.value = "view";
  emit("cancel");
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function getEditorHtml(): string {
  const raw = editorRef.value?.editor as any;
  const editor = raw && typeof raw.getHTML === "function" ? raw : raw?.value;
  return editor?.getHTML?.() ?? "";
}

async function doSave() {
  saving.value = true;
  const html = getEditorHtml();
  const markdown = turndown.turndown(html);
  emit("save", markdown);
  saving.value = false;
  mode.value = "view";
}

// hideToolbar 모드(다이얼로그 등에 순수 컴포저로 임베드된 경우)에서
// 부모가 자체 "등록" 버튼을 누른 시점에 현재 편집 중인 내용을 가져가는 용도 -
// 저장 이벤트 emit이나 모드 전환 없이 markdown만 반환한다.
function getMarkdown(): string {
  return turndown.turndown(getEditorHtml());
}

defineExpose({ enterEdit, getMarkdown });
</script>
