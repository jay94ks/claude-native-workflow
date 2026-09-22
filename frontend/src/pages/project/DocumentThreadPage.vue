<template>
  <div class="q-pa-md" style="max-width: var(--gh-page-width-wide); margin: 0 auto">
    <PageHeader variant="detail" title="Q&A 스레드" :on-back="goBack" />

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <template v-else-if="item">
      <!-- 설계자 요청(2026-09-21 후속, 세 번째 라운드) - 카드 레이아웃을
           DocumentDiscussion.vue와 동일하게: 좌측 상단 타입뱃지+제목,
           우측 상단 상태뱃지+작성자뱃지+more(⋮) 메뉴(확인함/답변작성/
           완료처리/폐기를 그 안에 모음), 본문은 Markdown 렌더링. -->
      <DiscussionItemCard
        :code="item.code"
        :kind="item.kind"
        :title="item.title"
        :state="item.state"
        :author="item.author"
        :content="item.content"
        :error="itemActionError"
        :has-menu="hasItemMenu"
        padding-class="q-pa-md q-mb-md"
      >
        <template #menu>
          <q-item v-if="canMarkRead" clickable :disable="busy === item.code" @click="markRead">
            <q-item-section>확인함</q-item-section>
          </q-item>
          <q-item v-if="canAnswer && !answeringHere" clickable @click="openAnswerComposer">
            <q-item-section>답변 작성</q-item-section>
          </q-item>
          <q-item v-if="canMarkDone" clickable :disable="busy === item.code" @click="markDone">
            <q-item-section>완료 처리</q-item-section>
          </q-item>
          <q-item v-if="canDiscard" clickable :disable="busy === item.code" @click="discardSelf">
            <q-item-section class="text-negative">폐기</q-item-section>
          </q-item>
        </template>

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
      </DiscussionItemCard>

      <div class="text-subtitle2 q-mb-sm">자식 항목 ({{ children.length }})</div>
      <EmptyState v-if="children.length === 0" message="자식 항목이 없습니다." />
      <DiscussionItemCard
        v-for="child in children"
        :key="child.code"
        :code="child.code"
        :kind="child.kind"
        :title="child.title"
        :state="child.state"
        :author="child.author"
        :content="child.content"
        :error="childActionError[child.code]"
        :has-menu="hasChildMenu(child)"
      >
        <template #menu>
          <q-item v-if="(childCounts[child.code] ?? 0) > 0" clickable :to="`/${owner}/${projectId}/thread/${child.code}`">
            <q-item-section>자식 항목 보기 ({{ childCounts[child.code] }})</q-item-section>
          </q-item>
          <q-item v-if="canMarkChildRead(child)" clickable :disable="busy === child.code" @click="markChildRead(child)">
            <q-item-section>확인함</q-item-section>
          </q-item>
          <q-item v-if="canMarkChildDone(child)" clickable :disable="busy === child.code" @click="markChildDone(child)">
            <q-item-section>완료 처리</q-item-section>
          </q-item>
          <q-item v-if="canDiscardChild(child)" clickable :disable="busy === child.code" @click="discardChild(child)">
            <q-item-section class="text-negative">폐기</q-item-section>
          </q-item>
        </template>
      </DiscussionItemCard>
    </template>
    <div v-else class="text-negative text-caption">문서를 찾을 수 없습니다.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import PageHeader from "components/PageHeader.vue";
import EmptyState from "components/EmptyState.vue";
import DiscussionItemCard from "components/DiscussionItemCard.vue";
import * as api from "src/api/client";

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
// DocumentDiscussion.vue와 동일한 중복 클릭 방지 가드 - 이 페이지엔
// 지금까지 없었다(2026-09-22 후속 발견, 프론트엔드 UI 일관성 정리
// 라운드에서 DiscussionItemCard로 추출하며 같이 추가).
const busy = ref<string | null>(null);

function parseIdFromCode(code: string): string {
  return code.split("-")[1] ?? code;
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
  busy.value = child.code;
  childActionError[child.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, child.code, "read", child.state);
  busy.value = null;
  if (!result.ok) {
    childActionError[child.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markRead() {
  if (!item.value) return;
  busy.value = item.value.code;
  itemActionError.value = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.value.code, "read", item.value.state);
  busy.value = null;
  if (!result.ok) {
    itemActionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markDone() {
  if (!item.value) return;
  busy.value = item.value.code;
  itemActionError.value = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.value.code, "done", item.value.state);
  busy.value = null;
  if (!result.ok) {
    itemActionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function discardSelf() {
  if (!item.value) return;
  busy.value = item.value.code;
  itemActionError.value = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.value.code, "discard", item.value.state);
  busy.value = null;
  if (!result.ok) {
    itemActionError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markChildDone(child: DocFull) {
  busy.value = child.code;
  childActionError[child.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, child.code, "done", child.state);
  busy.value = null;
  if (!result.ok) {
    childActionError[child.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function discardChild(child: DocFull) {
  busy.value = child.code;
  childActionError[child.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, child.code, "discard", child.state);
  busy.value = null;
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
