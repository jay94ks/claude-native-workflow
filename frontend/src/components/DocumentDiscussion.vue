<template>
  <div>
    <div class="text-subtitle2 q-mb-sm">Discussion</div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <div v-else-if="thread.length === 0" class="text-caption q-mb-md" style="color: var(--gh-fg-muted)">
      아직 이 문서에 달린 질의/의견이 없습니다.
    </div>

    <!-- PR 리뷰 코멘트처럼 - 이 문서(parentCode)에 달린 question(+answer)/opinion을 시간순으로 보여준다. -->
    <div
      v-for="item in thread"
      :id="`qa-${item.code}`"
      :key="item.code"
      class="gh-card q-pa-sm q-mb-sm"
      :class="{ 'qa-highlighted': !!highlightCode && (item.code === highlightCode || item.answer?.code === highlightCode) }"
    >
      <div class="row items-center justify-between">
        <div class="row items-center" style="gap: 6px">
          <div class="gh-avatar" style="width: 22px; height: 22px; font-size: 11px">{{ item.author === "agent" ? "C" : "A" }}</div>
          <span class="text-caption text-weight-medium">{{ item.author === "agent" ? "claude" : "architect" }}</span>
          <q-badge :color="item.kind === 'OP' ? 'teal' : 'primary'" outline dense>{{ item.kind === "OP" ? "opinion" : "question" }}</q-badge>
        </div>
        <div class="row items-center" style="gap: 2px">
          <q-badge :color="stateColor(item.state)">{{ item.state }}</q-badge>
          <!-- 설계자 요청(2026-09-21) - Q&A는 계층 구조(질문->답변->재질의->...)인데
               이 스레드 카드는 딱 한 단계(질문+그 직접 답변)만 보여준다. 그 이상
               자식이 있으면 more 아이콘으로 별도 페이지에서 계속 내려가며 본다. -->
          <q-btn
            v-if="(childCounts[item.code] ?? 0) > 0"
            flat
            dense
            round
            size="sm"
            icon="more_horiz"
            :to="`/projects/${projectId}/thread/${item.code}`"
          >
            <q-tooltip>자식 항목 {{ childCounts[item.code] }}개 보기</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div class="text-body2 q-mt-xs" style="white-space: pre-wrap">{{ item.content }}</div>

      <template v-if="item.kind !== 'OP'">
        <div v-if="item.answer" class="gh-card q-pa-sm q-mt-sm" style="background: var(--gh-canvas-subtle)">
          <div class="row items-center justify-between">
            <div class="row items-center" style="gap: 6px">
              <div class="gh-avatar" style="width: 20px; height: 20px; font-size: 10px">{{ item.answer.author === "agent" ? "C" : "A" }}</div>
              <span class="text-caption text-weight-medium">{{ item.answer.author === "agent" ? "claude" : "architect" }}의 답변</span>
              <q-badge :color="stateColor(item.answer.state)">{{ item.answer.state }}</q-badge>
            </div>
            <q-btn
              v-if="(childCounts[item.answer.code] ?? 0) > 0"
              flat
              dense
              round
              size="sm"
              icon="more_horiz"
              :to="`/projects/${projectId}/thread/${item.answer.code}`"
            >
              <q-tooltip>자식 항목 {{ childCounts[item.answer.code] }}개 보기</q-tooltip>
            </q-btn>
          </div>
          <div class="text-body2 q-mt-xs" style="white-space: pre-wrap">{{ item.answer.content }}</div>
        </div>
        <div class="q-mt-sm">
          <q-btn v-if="item.author === 'agent' && item.state === 'added'" size="sm" color="primary" label="확인함" :loading="busy === item.code" @click="markRead(item)" />
          <template v-else-if="item.author === 'agent' && item.state === 'read' && !item.answer">
            <q-btn v-if="answeringCode !== item.code" size="sm" color="secondary" label="답변 작성" @click="openAnswerComposer(item)" />
            <q-slide-transition v-else>
              <div class="q-mt-sm">
                <MarkdownSourceView ref="answerEditorRef" content="" start-in-edit hide-toolbar :edit-min-height="200" />
                <div v-if="answerError" class="text-negative text-caption q-mt-xs">{{ answerError }}</div>
                <div class="row justify-end q-gutter-sm q-mt-sm">
                  <q-btn flat label="취소하기" @click="closeAnswerComposer" />
                  <q-btn color="primary" label="등록하기" :loading="answering" @click="submitAnswer" />
                </div>
              </div>
            </q-slide-transition>
          </template>
        </div>
      </template>
      <div v-else-if="item.state === 'added' || item.state === 'read'" class="q-mt-sm">
        <q-btn size="sm" color="negative" label="폐기" @click="discardOpinion(item)" />
      </div>
      <div v-if="actionError[item.code]" class="text-negative text-caption q-mt-xs">{{ actionError[item.code] }}</div>
    </div>

    <!-- 설계자 요청(2026-09-21) - 질문하기/의견 남기기는 다이얼로그가 아니라
         이 영역이 그대로 늘어나며 에디터를 보여주고, 에디터 하단 우측에
         등록하기/취소하기 버튼을 둔다. -->
    <div v-if="!showAskComposer && !showOpinionComposer" class="row q-gutter-sm q-mt-sm">
      <q-btn size="sm" outline color="primary" icon="help" label="질문하기" @click="openAskComposer" />
      <q-btn size="sm" outline color="teal" icon="chat" label="의견 남기기" @click="openOpinionComposer" />
    </div>

    <q-slide-transition>
      <div v-if="showAskComposer" class="gh-card q-pa-sm q-mt-sm">
        <div class="text-subtitle2 q-mb-sm">이 문서에 질문하기</div>
        <q-input v-model="askTitle" label="제목" dense class="q-mb-sm" />
        <MarkdownSourceView ref="askEditorRef" content="" start-in-edit hide-toolbar :edit-min-height="200" />
        <div v-if="askError" class="text-negative text-caption q-mt-xs">{{ askError }}</div>
        <div class="row justify-end q-gutter-sm q-mt-sm">
          <q-btn flat label="취소하기" @click="closeAskComposer" />
          <q-btn color="primary" label="등록하기" :loading="asking" @click="ask" />
        </div>
      </div>
    </q-slide-transition>

    <q-slide-transition>
      <div v-if="showOpinionComposer" class="gh-card q-pa-sm q-mt-sm">
        <div class="text-subtitle2 q-mb-sm">이 문서에 의견 남기기</div>
        <q-input v-model="opinionTitle" label="제목" dense class="q-mb-sm" />
        <MarkdownSourceView ref="opinionEditorRef" content="" start-in-edit hide-toolbar :edit-min-height="200" />
        <div v-if="opinionError" class="text-negative text-caption q-mt-xs">{{ opinionError }}</div>
        <div class="row justify-end q-gutter-sm q-mt-sm">
          <q-btn flat label="취소하기" @click="closeOpinionComposer" />
          <q-btn color="primary" label="등록하기" :loading="submittingOpinion" @click="submitOpinion" />
        </div>
      </div>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from "vue";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import * as api from "src/api/client";

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

const props = defineProps<{ projectId: string; parentCode: string; highlightCode?: string }>();
const auth = useAuthStore();

const loading = ref(true);
const questions = ref<DocFull[]>([]);
const answers = ref<DocFull[]>([]);
const opinions = ref<DocFull[]>([]);
const busy = ref<string | null>(null);
const actionError = reactive<Record<string, string>>({});
const childCounts = reactive<Record<string, number>>({});

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
  const listResult = await api.listDocuments(auth.apiKey!, props.projectId, { type, parentId });
  if (!listResult.ok) return [];
  const summaries = (listResult.data as { items: DocSummary[] }).items;
  const fulls = await Promise.all(
    summaries.map(async (s) => {
      const r = await api.getDocument(auth.apiKey!, props.projectId, s.code);
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
  await loadChildCounts();
}

// answer의 parent_id는 "그 질문"의 id이지 이 문서의 id가 아니므로, 이 문서에
// 달린 질문들의 id 목록에 매칭되는 answer만 전체 answer 중에서 걸러낸다.
async function loadAllAnswers(): Promise<DocFull[]> {
  const listResult = await api.listDocuments(auth.apiKey!, props.projectId, { type: "answer" });
  if (!listResult.ok) return [];
  const summaries = (listResult.data as { items: DocSummary[] }).items;
  const fulls = await Promise.all(
    summaries.map(async (s) => {
      const r = await api.getDocument(auth.apiKey!, props.projectId, s.code);
      return r.ok ? (r.data as DocFull) : null;
    })
  );
  return fulls.filter((d): d is DocFull => d !== null);
}

// design-notes.md 후속 판단(설계자 요청, 2026-09-21) - Q&A는 실제로는
// 계층 구조(질문->답변->그 답변에 대한 재질의->...)인데 이 스레드 카드는
// 딱 한 단계(질문+직접 답변)만 보여준다. 카드마다(질문/답변 각각) 그
// "표시된 것 이상의" 자식이 있는지 세어뒀다가 more 아이콘을 조건부로
// 보여준다 - 질문 카드는 이미 보여준 직접 답변 자신은 자식 수에서 뺀다.
async function loadChildCounts() {
  const targets: { code: string; excludeCode?: string }[] = [];
  for (const item of thread.value) {
    targets.push({ code: item.code, excludeCode: item.answer?.code });
    if (item.answer) targets.push({ code: item.answer.code });
  }
  await Promise.all(
    targets.map(async ({ code, excludeCode }) => {
      const rawId = parseIdFromCode(code);
      const result = await api.listDocuments(auth.apiKey!, props.projectId, { parentId: rawId });
      if (!result.ok) return;
      const items = (result.data as { items: { code: string }[] }).items;
      childCounts[code] = items.filter((c) => c.code !== excludeCode).length;
    })
  );
}

async function markRead(item: ThreadItem) {
  busy.value = item.code;
  actionError[item.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.projectId, item.code, "read", item.state);
  busy.value = null;
  if (!result.ok) {
    actionError[item.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

const showAskComposer = ref(false);
const askTitle = ref("");
const askEditorRef = ref<MarkdownSourceViewRef | null>(null);
const asking = ref(false);
const askError = ref("");

function openAskComposer() {
  askTitle.value = "";
  askError.value = "";
  showAskComposer.value = true;
}
function closeAskComposer() {
  showAskComposer.value = false;
}

async function ask() {
  asking.value = true;
  askError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.projectId, {
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
  showAskComposer.value = false;
  askTitle.value = "";
  await load();
}

const answeringCode = ref<string | null>(null);
const answerEditorRef = ref<MarkdownSourceViewRef | null>(null);
const answering = ref(false);
const answerError = ref("");

function openAnswerComposer(item: ThreadItem) {
  answeringCode.value = item.code;
  answerError.value = "";
}
function closeAnswerComposer() {
  answeringCode.value = null;
}

async function submitAnswer() {
  if (!answeringCode.value) return;
  const question = thread.value.find((t) => t.code === answeringCode.value);
  if (!question) return;
  answering.value = true;
  answerError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.projectId, {
    type: "answer",
    kind: "AN",
    parentId: question.code,
    title: `Re: ${question.title}`,
    content: answerEditorRef.value?.getMarkdown() ?? "",
  });
  answering.value = false;
  if (!result.ok) {
    answerError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  answeringCode.value = null;
  await load();
}

const showOpinionComposer = ref(false);
const opinionTitle = ref("");
const opinionEditorRef = ref<MarkdownSourceViewRef | null>(null);
const submittingOpinion = ref(false);
const opinionError = ref("");

function openOpinionComposer() {
  opinionTitle.value = "";
  opinionError.value = "";
  showOpinionComposer.value = true;
}
function closeOpinionComposer() {
  showOpinionComposer.value = false;
}

async function submitOpinion() {
  submittingOpinion.value = true;
  opinionError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.projectId, {
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
  showOpinionComposer.value = false;
  opinionTitle.value = "";
  await load();
}

async function discardOpinion(item: ThreadItem) {
  const result = await api.transitionDocument(auth.apiKey!, props.projectId, item.code, "discard", item.state);
  if (result.ok) await load();
}

onMounted(async () => {
  await load();
  scrollToHighlight();
});
watch(() => props.parentCode, load);

// 설계자 요청(2026-09-21) - RecentQaFeed에서 넘어온 highlightCode가 있으면
// 그 Q&A 카드까지 스크롤하고 잠깐 강조 표시한다(위 template의 qa-highlighted
// 클래스, 아래 style). DOM이 실제로 그려진 다음이라야 element가 있으므로
// load() 완료 뒤 nextTick으로 한 틱 더 기다린다.
function scrollToHighlight() {
  if (!props.highlightCode) return;
  nextTick(() => {
    document.getElementById(`qa-${props.highlightCode}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
</script>

<style scoped>
.qa-highlighted {
  outline: 2px solid var(--gh-accent);
  animation: qa-highlight-fade 2.5s ease-out;
}
@keyframes qa-highlight-fade {
  from {
    background: rgba(9, 105, 218, 0.12);
  }
  to {
    background: transparent;
  }
}
</style>
