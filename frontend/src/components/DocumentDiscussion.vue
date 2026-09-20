<template>
  <div>
    <div class="text-subtitle2 q-mb-sm">Discussion</div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <div v-else-if="thread.length === 0" class="text-caption q-mb-md" style="color: var(--gh-fg-muted)">
      아직 이 문서에 달린 질의/의견이 없습니다.
    </div>

    <!-- PR 리뷰 코멘트처럼 - 이 문서(parentCode)에 달린 question(+answer)/opinion을 시간순으로 보여준다. -->
    <div v-for="item in thread" :key="item.code" class="gh-card q-pa-sm q-mb-sm">
      <div class="row items-center justify-between">
        <div class="row items-center" style="gap: 6px">
          <div class="gh-avatar" style="width: 22px; height: 22px; font-size: 11px">{{ item.author === "agent" ? "C" : "A" }}</div>
          <span class="text-caption text-weight-medium">{{ item.author === "agent" ? "claude" : "architect" }}</span>
          <q-badge :color="item.kind === 'OP' ? 'teal' : 'primary'" outline dense>{{ item.kind === "OP" ? "opinion" : "question" }}</q-badge>
        </div>
        <q-badge :color="stateColor(item.state)">{{ item.state }}</q-badge>
      </div>
      <div class="text-body2 q-mt-xs" style="white-space: pre-wrap">{{ item.content }}</div>

      <template v-if="item.kind !== 'OP'">
        <div v-if="item.answer" class="gh-card q-pa-sm q-mt-sm" style="background: var(--gh-canvas-subtle)">
          <div class="row items-center" style="gap: 6px">
            <div class="gh-avatar" style="width: 20px; height: 20px; font-size: 10px">{{ item.answer.author === "agent" ? "C" : "A" }}</div>
            <span class="text-caption text-weight-medium">{{ item.answer.author === "agent" ? "claude" : "architect" }}의 답변</span>
            <q-badge :color="stateColor(item.answer.state)">{{ item.answer.state }}</q-badge>
          </div>
          <div class="text-body2 q-mt-xs" style="white-space: pre-wrap">{{ item.answer.content }}</div>
        </div>
        <div class="q-mt-sm">
          <q-btn v-if="item.author === 'agent' && item.state === 'added'" size="sm" color="primary" label="확인함" :loading="busy === item.code" @click="markRead(item)" />
          <q-btn v-else-if="item.author === 'agent' && item.state === 'read' && !item.answer" size="sm" color="secondary" label="답변 작성" @click="openAnswerDialog(item)" />
        </div>
      </template>
      <div v-else-if="item.state === 'added' || item.state === 'read'" class="q-mt-sm">
        <q-btn size="sm" color="negative" label="폐기" @click="discardOpinion(item)" />
      </div>
      <div v-if="actionError[item.code]" class="text-negative text-caption q-mt-xs">{{ actionError[item.code] }}</div>
    </div>

    <!-- 댓글 입력창 자리 - "질문하기"/"의견 남기기" 두 버튼으로 이 문서에 새 항목을 붙인다. -->
    <div class="row q-gutter-sm q-mt-sm">
      <q-btn size="sm" outline color="primary" icon="help" label="질문하기" @click="showAskDialog = true" />
      <q-btn size="sm" outline color="teal" icon="chat" label="의견 남기기" @click="showOpinionDialog = true" />
    </div>

    <q-dialog v-model="showAskDialog">
      <q-card style="width: 640px; max-width: 90vw">
        <q-card-section class="text-h6">이 문서에 질문하기</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="askTitle" label="제목" />
          <MarkdownSourceView ref="askEditorRef" content="" start-in-edit hide-toolbar />
          <div v-if="askError" class="text-negative text-caption">{{ askError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="등록" :loading="asking" @click="ask" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showAnswerDialog">
      <q-card style="width: 640px; max-width: 90vw">
        <q-card-section class="text-h6">답변 작성</q-card-section>
        <q-card-section class="q-gutter-md">
          <MarkdownSourceView ref="answerEditorRef" content="" start-in-edit hide-toolbar />
          <div v-if="answerError" class="text-negative text-caption">{{ answerError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="등록" :loading="answering" @click="submitAnswer" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showOpinionDialog">
      <q-card style="width: 640px; max-width: 90vw">
        <q-card-section class="text-h6">이 문서에 의견 남기기</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="opinionTitle" label="제목" />
          <MarkdownSourceView ref="opinionEditorRef" content="" start-in-edit hide-toolbar />
          <div v-if="opinionError" class="text-negative text-caption">{{ opinionError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="등록" :loading="submittingOpinion" @click="submitOpinion" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";

interface MarkdownSourceViewRef {
  getMarkdown(): string;
}

interface DocSummary {
  code: string;
  parent_id: string | null;
  etag: string;
  state: string;
  kind: string;
  title: string;
  author: string;
  createdAt: string;
}
interface DocFull extends DocSummary {
  content: string;
}
interface ThreadItem extends DocFull {
  answer: DocFull | null;
}

// props.parentCode(예: "SP-XXXXXXXX")에서 순수 id만 - question/opinion의
// parent_id는 그 id로 저장돼 있다(docsAdd가 parentId로 받은 추적 코드를
// parseTrackingCode()로 풀어 id만 저장).
function parseIdFromCode(code: string): string {
  return code.split("-")[1] ?? code;
}

const props = defineProps<{ projectId: string; parentCode: string }>();
const auth = useAuthStore();

const loading = ref(true);
const questions = ref<DocFull[]>([]);
const answers = ref<DocFull[]>([]);
const opinions = ref<DocFull[]>([]);
const busy = ref<string | null>(null);
const actionError = reactive<Record<string, string>>({});

const thread = computed<ThreadItem[]>(() => {
  const qItems: ThreadItem[] = questions.value.map((q) => ({
    ...q,
    answer: answers.value.find((a) => a.parent_id === parseIdFromCode(q.code)) ?? null,
  }));
  const oItems: ThreadItem[] = opinions.value.map((o) => ({ ...o, answer: null }));
  return [...qItems, ...oItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
});

function stateColor(state: string): string {
  if (state === "done") return "positive";
  if (state === "discard") return "grey-6";
  return "primary";
}

// backend/src/core/documents.ts의 docsList가 payload.parentId를 Document.parentId
// 컬럼(원문 id) 그대로 필터링해준다 - 추적 코드가 아니라 id를 넘겨야 한다.
async function loadDocsByParent(type: string, parentId: string): Promise<DocFull[]> {
  const listResult = await auth.run({ action: "docs.list", projectId: props.projectId, type, parentId });
  if (!listResult.ok) return [];
  const summaries = (listResult.data as { items: DocSummary[] }).items;
  const fulls = await Promise.all(
    summaries.map(async (s) => {
      const r = await auth.run({ action: "docs.get", projectId: props.projectId, code: s.code });
      return r.ok ? (r.data as DocFull) : null;
    })
  );
  return fulls.filter((d): d is DocFull => d !== null);
}

async function load() {
  loading.value = true;
  const parentId = parseIdFromCode(props.parentCode);
  const [q, a, o] = await Promise.all([
    loadDocsByParent("question", parentId),
    loadAllAnswers(),
    loadDocsByParent("opinion", parentId),
  ]);
  questions.value = q;
  answers.value = a;
  opinions.value = o;
  loading.value = false;
}

// answer의 parent_id는 "그 질문"의 id이지 이 문서의 id가 아니므로, 이 문서에
// 달린 질문들의 id 목록에 매칭되는 answer만 전체 answer 중에서 걸러낸다.
async function loadAllAnswers(): Promise<DocFull[]> {
  const listResult = await auth.run({ action: "docs.list", projectId: props.projectId, type: "answer" });
  if (!listResult.ok) return [];
  const summaries = (listResult.data as { items: DocSummary[] }).items;
  const fulls = await Promise.all(
    summaries.map(async (s) => {
      const r = await auth.run({ action: "docs.get", projectId: props.projectId, code: s.code });
      return r.ok ? (r.data as DocFull) : null;
    })
  );
  return fulls.filter((d): d is DocFull => d !== null);
}

async function markRead(item: ThreadItem) {
  busy.value = item.code;
  actionError[item.code] = "";
  const result = await auth.run({ action: "docs.transition", projectId: props.projectId, state: { [item.code]: ["read", item.state] } });
  busy.value = null;
  if (!result.ok) {
    actionError[item.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

const showAskDialog = ref(false);
const askTitle = ref("");
const askEditorRef = ref<MarkdownSourceViewRef | null>(null);
const asking = ref(false);
const askError = ref("");

async function ask() {
  asking.value = true;
  askError.value = "";
  const result = await auth.run({
    action: "docs.add",
    projectId: props.projectId,
    type: "question",
    kind: "QU",
    parentId: props.parentCode,
    title: askTitle.value,
    content: askEditorRef.value?.getMarkdown() ?? "",
  });
  asking.value = false;
  if (!result.ok) {
    askError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  showAskDialog.value = false;
  askTitle.value = "";
  await load();
}

const showAnswerDialog = ref(false);
const answeringQuestion = ref<ThreadItem | null>(null);
const answerEditorRef = ref<MarkdownSourceViewRef | null>(null);
const answering = ref(false);
const answerError = ref("");

function openAnswerDialog(item: ThreadItem) {
  answeringQuestion.value = item;
  answerError.value = "";
  showAnswerDialog.value = true;
}

async function submitAnswer() {
  if (!answeringQuestion.value) return;
  answering.value = true;
  answerError.value = "";
  const result = await auth.run({
    action: "docs.add",
    projectId: props.projectId,
    type: "answer",
    kind: "AN",
    parentId: answeringQuestion.value.code,
    title: `Re: ${answeringQuestion.value.title}`,
    content: answerEditorRef.value?.getMarkdown() ?? "",
  });
  answering.value = false;
  if (!result.ok) {
    answerError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  showAnswerDialog.value = false;
  await load();
}

const showOpinionDialog = ref(false);
const opinionTitle = ref("");
const opinionEditorRef = ref<MarkdownSourceViewRef | null>(null);
const submittingOpinion = ref(false);
const opinionError = ref("");

async function submitOpinion() {
  submittingOpinion.value = true;
  opinionError.value = "";
  const result = await auth.run({
    action: "docs.add",
    projectId: props.projectId,
    type: "opinion",
    kind: "OP",
    parentId: props.parentCode,
    title: opinionTitle.value,
    content: opinionEditorRef.value?.getMarkdown() ?? "",
  });
  submittingOpinion.value = false;
  if (!result.ok) {
    opinionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  showOpinionDialog.value = false;
  opinionTitle.value = "";
  await load();
}

async function discardOpinion(item: ThreadItem) {
  const result = await auth.run({ action: "docs.transition", projectId: props.projectId, state: { [item.code]: ["discard", item.state] } });
  if (result.ok) await load();
}

onMounted(load);
watch(() => props.parentCode, load);
</script>
