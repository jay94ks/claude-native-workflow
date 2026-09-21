<template>
  <div class="yiitap-source-view">
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
         모드"(마크다운을 HTML로 렌더링해서 보여주기만), editable=true가 "편집 모드".

         설계자 요청(2026-09-21) - 툴바(main menu)는 항상 보이되, 보기
         모드에선 비활성(회색+클릭 무시), 편집 모드에선 활성. yiitap
         커맨드는 editable=false여도 프로그래매틱으로는 실행되므로
         show-main-menu만 켜두면 보기 모드에서도 눌려서 내용이 바뀔 수
         있다 - 그래서 CSS로 완전히 pointer-events를 막는다(아래
         .source-view-toolbar-disabled). main-menu 항목 자체도 마크다운과
         호환 안 되는 것(폰트/색/정렬/테이블/callout/AI 등)은 뺐다. -->
    <!-- 설계자 요청(2026-09-21, 항목 5/12) - yiitap의 `.ProseMirror`는
         기본으로 좌우 54px(padding-inline)을 항상 예약해둔다(좌측
         인터랙티브 사이드 메뉴 자리) - 편집 모드에선 실제로 그 메뉴가
         뜨니(yiitap 자체가 editable일 때만 렌더링) 여백이 있는 게
         맞지만, 보기 모드에선 메뉴 자체가 안 뜨는데 여백만 남아
         내용이 툴바 대비 이상하게 오른쪽으로 밀려 보였다(항목 12) -
         보기 모드에서 그 여백을 0으로 되돌린다. 편집 모드는 추가로
         최소 높이(sv-edit-min-height, 문서는 300px/Q&A 컴포저는
         200px)와 흰 배경을 준다(편집 영역임을 구분). -->
    <div
      :class="{ 'source-view-toolbar-disabled': mode === 'view', 'sv-view': mode === 'view', 'sv-edit': mode === 'edit' }"
      :style="mode === 'edit' ? { '--sv-edit-min-height': editMinHeight + 'px' } : {}"
    >
      <YiiEditor
        v-if="mode === 'edit'"
        :key="'edit-' + editorKey"
        ref="editorRef"
        :content="htmlForEdit"
        editable
        show-main-menu
        show-bubble-menu
        show-side-menu
        :main-menu="MARKDOWN_MAIN_MENU"
        :extensions="YIITAP_EXTENSIONS"
        page-view="page"
      />
      <YiiEditor
        v-else
        :key="'view-' + editorKey"
        :content="htmlForView"
        :editable="false"
        show-main-menu
        :main-menu="MARKDOWN_MAIN_MENU"
        :extensions="YIITAP_EXTENSIONS"
        :show-bubble-menu="false"
        :show-floating-menu="false"
        :show-side-node="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { YiiEditor, OStarterKit } from "@yiitap/vue";
import { marked } from "marked";
import TurndownService from "turndown";
import "@yiitap/vue/dist/vue.css";

// 중요: YiiEditor의 `extensions` prop 문서 주석은 "기본으로 BuiltinExtensions를
// 켠다"고 돼 있지만, 실제 컴파일된 코드(node_modules/@yiitap/vue/dist/index.mjs)를
// 직접 뜯어보면 그 prop의 실제 기본값은 빈 배열이고, 내부 베이스 에디터도
// codeBlock/blockquote/horizontalRule/link/document를 명시적으로 꺼둔 채로
// 만들어진다 - 즉 이 prop을 안 넘기면 문서 주석과 달리 codeBlock/blockquote/
// horizontalRule/link 툴바 버튼이 눌러도 아무 일도 안 일어난다(버튼은 보이지만
// 그 노드/마크 자체가 스키마에 없음). 실기동 중 코드 탭 파일을 펜스 코드
// 블록으로 감싸 편집했더니 실제로는 인라인 code+<br>로 뭉개지는 걸 보고
// 발견했다 - OStarterKit.configure()로 명시적으로 켜야 한다.
// 동시에 이 configure 호출로 마크다운과 호환 안 되는 기능(색/폰트/정렬/
// 테이블/callout/위첨자·아래첨자/타이포그래피 자동 치환)은 아예 확장
// 자체를 꺼서 제외한다 - main-menu에서 버튼만 숨기는 것보다 확실하다
// (슬래시 커맨드 등 다른 경로로도 못 들어옴). 나머지(OBlockquote/
// OCodeBlock/OHorizontalRule/OLink/TaskItem/TaskList/OSlash 등)는
// DefaultExtensionNames(node_modules 확인) 그대로 유지.
const YIITAP_EXTENSIONS = OStarterKit.configure({
  BackgroundColor: false,
  Color: false,
  Focus: false,
  FontFamily: false,
  Highlight: false,
  Subscript: false,
  Superscript: false,
  TextAlign: false,
  TextStyle: false,
  Typography: false,
  OCallout: false,
  OTable: false,
});

// yiitap 기본 main menu(Vp, node_modules/@yiitap/vue/dist/index.mjs)에서
// 마크다운으로 안 옮겨지거나(font-family/text-color/highlight/align/
// table/callout) 인프라가 없는 것(aiBlock)을 뺀 목록 - 설계자 요청
// "마크다운과 호환되지 않는 기능은 제외해도 돼"에 따른 판단.
const MARKDOWN_MAIN_MENU = [
  "bold",
  "italic",
  "text-format-dropdown",
  "separator",
  "heading",
  "clearFormat",
  "separator",
  "horizontalRule",
  "blockquote",
  "list-dropdown",
  "codeBlock",
  "link",
  "separator",
  "emoji",
];

const props = withDefaults(
  defineProps<{ content: string; readOnly?: boolean; startInEdit?: boolean; hideToolbar?: boolean; editMinHeight?: number }>(),
  { readOnly: false, startInEdit: false, hideToolbar: false, editMinHeight: 300 }
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

<style scoped>
/* 버그(설계자 지적, 2026-09-21): yiitap 자체 CSS(node_modules/@yiitap/vue/
   dist/vue.css)의 `.yiitap{display:flex; justify-content:center}` 규칙이
   flex-direction을 안 정해줘서 기본값인 row가 적용된다 - 그 바로 아래
   직속 자식이 툴바(.o-main-menu 섹션)와 실제 내용(.editor-content
   div) 둘뿐인데, row라서 이 둘이 세로로 쌓이지 않고 가로로 나란히
   배치돼(내용이 툴바 "아래"가 아니라 "오른쪽"에 보이는 상태) 있었다.
   yiitap이 내부적으로 이 조합을 column으로 고쳐줄 걸 놓친 것으로
   보이는 라이브러리 쪽 CSS 공백 - 여기서 직접 되돌린다. */
.yiitap-source-view :deep(main.yiitap) {
  flex-direction: column;
}
/* 보기 모드에선 툴바를 숨기지 않고 "비활성 상태"로 보여준다(설계자
   요청) - yiitap 커맨드는 editable=false에서도 프로그래매틱으로는
   실행되므로 pointer-events까지 막아야 실제로 눌리지 않는다. */
.source-view-toolbar-disabled :deep(.o-main-menu) {
  pointer-events: none;
  opacity: 0.45;
}
/* 보기 모드 - 사이드 메뉴 자리로 예약된 여백을 없애 내용이 왼쪽부터 시작하게 한다. */
.sv-view :deep(.ProseMirror) {
  padding-inline: 0;
}
/* 편집 모드 - 편집 영역임을 구분할 수 있게 흰 배경 + 내용 늘어나면 자동으로
   커지는 최소 높이(min-height, 문서는 300px/Q&A 컴포저는 200px). */
.sv-edit :deep(.ProseMirror) {
  min-height: var(--sv-edit-min-height, 300px);
  background: var(--gh-canvas);
}
</style>
