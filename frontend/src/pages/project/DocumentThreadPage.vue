<template>
  <div class="q-pa-md" style="max-width: 900px; margin: 0 auto">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense round icon="arrow_back" @click="goBack" />
      <div class="text-h6">Q&A 스레드</div>
    </div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <template v-else-if="item">
      <!-- 설계자 요청(2026-09-21 후속, 세 번째 라운드) - 카드 레이아웃을
           DocumentDiscussion.vue와 동일하게: 좌측 상단 타입뱃지+제목,
           우측 상단 상태뱃지+작성자뱃지+more(⋮) 메뉴(확인함/답변작성/
           완료처리/폐기를 그 안에 모음), 본문은 Markdown 렌더링. -->
      <div class="gh-card q-pa-md q-mb-md">
        <div class="row items-center justify-between">
          <div class="row items-center" style="gap: 6px; min-width: 0">
            <q-badge :color="kindColor(item.kind)" outline dense>{{ kindLabel(item.kind) }}</q-badge>
            <span class="text-weight-medium ellipsis">{{ item.title }}</span>
          </div>
          <div class="row items-center" style="gap: 4px; flex-shrink: 0">
            <q-badge :color="stateColor(item.state)">{{ item.state }}</q-badge>
            <div class="gh-avatar" style="width: 22px; height: 22px; font-size: 11px">{{ item.author === "agent" ? "C" : "A" }}</div>
            <q-btn v-if="hasItemMenu" flat dense round size="sm" icon="more_vert">
              <q-menu auto-close>
                <q-list style="min-width: 160px">
                  <q-item v-if="canMarkRead" clickable @click="markRead">
                    <q-item-section>확인함</q-item-section>
                  </q-item>
                  <q-item v-if="canAnswer && !answeringHere" clickable @click="openAnswerComposer">
                    <q-item-section>답변 작성</q-item-section>
                  </q-item>
                  <q-item v-if="canMarkDone" clickable @click="markDone">
                    <q-item-section>완료 처리</q-item-section>
                  </q-item>
                  <q-item v-if="canDiscard" clickable @click="discardSelf">
                    <q-item-section class="text-negative">폐기</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
        </div>
        <div class="text-body2 q-mt-xs markdown-body" v-html="renderMarkdownSafe(item.content)"></div>
        <div v-if="itemActionError" class="text-negative text-caption q-mt-xs">{{ itemActionError }}</div>

        <!-- 설계자 재지적(2026-09-21) - 이 항목 자체에 답하거나(질문일 때)
             재질의/의견을 남길 방법이 이 페이지엔 전혀 없었다 - 표시(더보기
             아이콘+자식 목록)만 있고 실제로 계층을 늘릴 창구가 빠져있던
             게 진짜 공백이었다. `documentRules.ts`의 chain 제약이 애초에
             "question/opinion은 부모 타입 제한 없음"이라 백엔드는 이미
             임의 깊이 중첩(질문의 답변에 재질의, 의견에 대한 재질의 등)을
             지원했다 - 여기 컴포저만 새로 추가하면 된다. -->
        <q-slide-transition>
          <div v-if="answeringHere" class="q-mt-sm">
            <MarkdownSourceView ref="answerEditorRef" content="" start-in-edit hide-toolbar :edit-min-height="200" />
            <div v-if="answerError" class="text-negative text-caption q-mt-xs">{{ answerError }}</div>
            <div class="row justify-end q-gutter-sm q-mt-sm">
              <q-btn flat label="취소하기" @click="answeringHere = false" />
              <q-btn color="primary" label="등록하기" :loading="answering" @click="submitAnswer" />
            </div>
          </div>
        </q-slide-transition>

        <div v-if="!showAskComposer && !showOpinionComposer" class="row q-gutter-sm q-mt-sm">
          <q-btn size="sm" outline color="primary" icon="help" label="재질의하기" @click="openAskComposer" />
          <q-btn size="sm" outline color="teal" icon="chat" label="의견 남기기" @click="openOpinionComposer" />
        </div>

        <q-slide-transition>
          <div v-if="showAskComposer" class="gh-card q-pa-sm q-mt-sm">
            <div class="text-subtitle2 q-mb-sm">이 항목에 재질의하기</div>
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
            <div class="text-subtitle2 q-mb-sm">이 항목에 의견 남기기</div>
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

      <div class="text-subtitle2 q-mb-sm">자식 항목 ({{ children.length }})</div>
      <div v-if="children.length === 0" class="text-caption" style="color: var(--gh-fg-muted)">자식 항목이 없습니다.</div>
      <div v-for="child in children" :key="child.code" class="gh-card q-pa-sm q-mb-sm">
        <div class="row items-center justify-between">
          <div class="row items-center" style="gap: 6px; min-width: 0">
            <q-badge :color="kindColor(child.kind)" outline dense>{{ kindLabel(child.kind) }}</q-badge>
            <span class="text-weight-medium ellipsis">{{ child.title }}</span>
          </div>
          <div class="row items-center" style="gap: 4px; flex-shrink: 0">
            <q-badge :color="stateColor(child.state)">{{ child.state }}</q-badge>
            <div class="gh-avatar" style="width: 20px; height: 20px; font-size: 10px">{{ child.author === "agent" ? "C" : "A" }}</div>
            <q-btn v-if="hasChildMenu(child)" flat dense round size="sm" icon="more_vert">
              <q-menu auto-close>
                <q-list style="min-width: 160px">
                  <q-item v-if="(childCounts[child.code] ?? 0) > 0" clickable :to="`/${owner}/${projectId}/thread/${child.code}`">
                    <q-item-section>자식 항목 보기 ({{ childCounts[child.code] }})</q-item-section>
                  </q-item>
                  <q-item v-if="canMarkChildRead(child)" clickable @click="markChildRead(child)">
                    <q-item-section>확인함</q-item-section>
                  </q-item>
                  <q-item v-if="canMarkChildDone(child)" clickable @click="markChildDone(child)">
                    <q-item-section>완료 처리</q-item-section>
                  </q-item>
                  <q-item v-if="canDiscardChild(child)" clickable @click="discardChild(child)">
                    <q-item-section class="text-negative">폐기</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
        </div>
        <div class="text-body2 q-mt-xs markdown-body" v-html="renderMarkdownSafe(child.content)"></div>
        <div v-if="childActionError[child.code]" class="text-negative text-caption q-mt-xs">{{ childActionError[child.code] }}</div>
      </div>
    </template>
    <div v-else class="text-negative text-caption">문서를 찾을 수 없습니다.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import * as api from "src/api/client";
import { renderMarkdownSafe } from "src/utils/renderMarkdown";

interface MarkdownSourceViewRef {
  getMarkdown(): string;
}

interface DocFull {
  code: string;
  kind: string;
  state: string;
  title: string;
  content: string;
  author: string;
}

const props = defineProps<{ owner: string; projectId: string; code: string }>();
const auth = useAuthStore();
const router = useRouter();

const loading = ref(true);
const item = ref<DocFull | null>(null);
const children = ref<DocFull[]>([]);
const childCounts = ref<Record<string, number>>({});
const itemActionError = ref("");
const childActionError = reactive<Record<string, string>>({});

function parseIdFromCode(code: string): string {
  return code.split("-")[1] ?? code;
}

function kindLabel(kind: string): string {
  if (kind === "QU") return "question";
  if (kind === "AN") return "answer";
  if (kind === "OP") return "opinion";
  return kind;
}
function kindColor(kind: string): string {
  if (kind === "OP") return "teal";
  if (kind === "AN") return "positive";
  return "primary";
}
function stateColor(state: string): string {
  if (state === "done") return "positive";
  if (state === "discard") return "grey-6";
  return "primary";
}

function goBack() {
  router.back();
}

// item이 question이고 이미 답변(child 중 kind==='AN')이 있으면 "답변 작성"을
// 다시 보여주지 않는다 - documentRules.ts의 chain 제약(질문 하나당 답변 하나)과
// 일치시킨 UI 힌트일 뿐, 실제 방지는 언제나 서버가 한다.
const hasAnswer = computed(() => children.value.some((c) => c.kind === "AN"));
// 아래 네 개는 DocumentDiscussion.vue와 동일한 게이트(documentRules.ts의
// checkTransition을 그대로 UI에 반영한 것 - 실제 허용 여부는 언제나 서버가
// 최종 판단한다).
// 버그(2026-09-21 재발견) - "완료 처리"(answer read->done)만 넣고 그
// 앞 단계인 added->read를 빼먹으면 answer.author==='agent'인 경우 그
// 상태가 영원히 added에 머물러 "완료 처리"에 도달할 수 없다(이 read
// 전이도 documentRules.ts상 질의자=architect만 가능) - question과
// 마찬가지로 answer도 이 게이트에 포함시킨다.
const canMarkRead = computed(
  () =>
    (item.value?.kind === "QU" || item.value?.kind === "AN") && item.value?.author === "agent" && item.value?.state === "added"
);
const canAnswer = computed(() => item.value?.kind === "QU" && item.value?.author === "agent" && item.value?.state === "read" && !hasAnswer.value);
// 설계자 요청(2026-09-21 후속) - answer 자신의 스레드 페이지("답변에 대한
// 재질의"를 보러 온 경우)에서도 그 답변을 완료 처리할 수 있어야 한다 -
// answer의 done 전이는 "질의자(그 answer 작성자의 반대 채널)만" 가능하므로
// WEB UI(=architect)가 누를 수 있는 건 answer.author==='agent'일 때뿐이다.
const canMarkDone = computed(() => item.value?.kind === "AN" && item.value?.author === "agent" && item.value?.state === "read");
// question의 discard는 "질의자 본인만, 미해소 상태에서만" - architect가
// 재질의하기로 만든 질문만 architect가 스스로 거둘 수 있다. opinion은
// 항상 architect가 쓴 것이므로 조건이 더 단순하다.
const canDiscard = computed(() => {
  if (!item.value) return false;
  if (item.value.state !== "added" && item.value.state !== "read") return false;
  if (item.value.kind === "OP") return true;
  return item.value.kind === "QU" && item.value.author === "architect";
});
const hasItemMenu = computed(() => canMarkRead.value || canAnswer.value || canMarkDone.value || canDiscard.value);

function canMarkChildRead(child: DocFull): boolean {
  return (child.kind === "QU" || child.kind === "AN") && child.author === "agent" && child.state === "added";
}
function canMarkChildDone(child: DocFull): boolean {
  return child.kind === "AN" && child.author === "agent" && child.state === "read";
}
function canDiscardChild(child: DocFull): boolean {
  if (child.state !== "added" && child.state !== "read") return false;
  if (child.kind === "OP") return true;
  return child.kind === "QU" && child.author === "architect";
}
function hasChildMenu(child: DocFull): boolean {
  return (childCounts.value[child.code] ?? 0) > 0 || canMarkChildRead(child) || canMarkChildDone(child) || canDiscardChild(child);
}

async function markChildRead(child: DocFull) {
  childActionError[child.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, child.code, "read", child.state);
  if (!result.ok) {
    childActionError[child.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markRead() {
  if (!item.value) return;
  itemActionError.value = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.value.code, "read", item.value.state);
  if (!result.ok) {
    itemActionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markDone() {
  if (!item.value) return;
  itemActionError.value = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.value.code, "done", item.value.state);
  if (!result.ok) {
    itemActionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function discardSelf() {
  if (!item.value) return;
  itemActionError.value = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.value.code, "discard", item.value.state);
  if (!result.ok) {
    itemActionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markChildDone(child: DocFull) {
  childActionError[child.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, child.code, "done", child.state);
  if (!result.ok) {
    childActionError[child.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function discardChild(child: DocFull) {
  childActionError[child.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, child.code, "discard", child.state);
  if (!result.ok) {
    childActionError[child.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function load() {
  loading.value = true;
  const result = await api.getDocument(auth.apiKey!, props.owner, props.projectId, props.code);
  if (!result.ok) {
    item.value = null;
    children.value = [];
    loading.value = false;
    return;
  }
  item.value = result.data as DocFull;

  const rawId = parseIdFromCode(props.code);
  const listResult = await api.listDocuments(auth.apiKey!, props.owner, props.projectId, { parentId: rawId });
  const summaries = listResult.ok ? (listResult.data as { items: { code: string }[] }).items : [];
  const fulls = await Promise.all(
    summaries.map(async (s) => {
      const r = await api.getDocument(auth.apiKey!, props.owner, props.projectId, s.code);
      return r.ok ? (r.data as DocFull) : null;
    })
  );
  children.value = fulls.filter((d): d is DocFull => d !== null);
  loading.value = false;

  // 각 자식이 또 자식을 갖는지(더 깊은 계층) - more 메뉴에 조건부로 넣기 위함.
  await Promise.all(
    children.value.map(async (child) => {
      const childRawId = parseIdFromCode(child.code);
      const r = await api.listDocuments(auth.apiKey!, props.owner, props.projectId, { parentId: childRawId });
      if (r.ok) childCounts.value[child.code] = (r.data as { items: unknown[] }).items.length;
    })
  );
}

const answeringHere = ref(false);
const answerEditorRef = ref<MarkdownSourceViewRef | null>(null);
const answering = ref(false);
const answerError = ref("");

function openAnswerComposer() {
  answerError.value = "";
  answeringHere.value = true;
}

async function submitAnswer() {
  if (!item.value) return;
  answering.value = true;
  answerError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.owner, props.projectId, {
    type: "answer",
    kind: "AN",
    parentId: item.value.code,
    title: `Re: ${item.value.title}`,
    content: answerEditorRef.value?.getMarkdown() ?? "",
  });
  answering.value = false;
  if (!result.ok) {
    answerError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  answeringHere.value = false;
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
  if (!item.value) return;
  asking.value = true;
  askError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.owner, props.projectId, {
    type: "question",
    kind: "QU",
    parentId: item.value.code,
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
  if (!item.value) return;
  submittingOpinion.value = true;
  opinionError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.owner, props.projectId, {
    type: "opinion",
    kind: "OP",
    parentId: item.value.code,
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

onMounted(load);
watch(() => [props.owner, props.projectId, props.code], load);
</script>

<style scoped>
.markdown-body :deep(p) {
  margin: 0 0 0.5em;
}
.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown-body :deep(pre) {
  background: var(--gh-canvas-subtle);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}
.markdown-body :deep(code) {
  font-family: monospace;
}
</style>
