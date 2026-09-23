<template>
  <div>
    <div class="text-subtitle2 q-mb-sm">Discussion</div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <div v-else-if="thread.length === 0" class="text-caption q-mb-md" style="color: var(--gh-fg-muted)">
      아직 이 문서에 달린 질의/의견이 없습니다.
    </div>

    <!-- PR 리뷰 코멘트처럼 - 이 문서(parentCode)에 달린 question(+answer)/opinion을 시간순으로 보여준다.
         설계자 요청(2026-09-21 후속, 세 번째 라운드) - 카드 레이아웃 재배치:
         좌측 상단은 [question]/[opinion] 타입 뱃지 + 제목(지금까지 title
         필드가 있는데도 화면에 전혀 안 보여줬다 - 실제 버그), 우측 상단은
         왼쪽부터 상태 뱃지 -> 작성자 뱃지 -> more(⋮) 아이콘. 폐기/완료
         처리/자식 항목 보기처럼 "동작"에 해당하는 건 전부 그 more 메뉴
         안으로 모은다(각 상태별 조건은 documentRules.ts의 checkTransition
         그대로 - 버튼을 안 보이게 하는 것도, 실제 허용 여부는 항상 서버가
         최종 판단한다는 원칙을 유지). -->
    <DiscussionItemCard
      v-for="item in thread"
      :key="item.code"
      :code="item.code"
      :kind="item.kind"
      :title="item.title"
      :state="item.state"
      :author="item.author"
      :content="item.content"
      :error="actionError[item.code]"
      :has-menu="hasItemMenu(item)"
      :highlighted="!!highlightCode && (item.code === highlightCode || item.answer?.code === highlightCode)"
      :editing="editingCode === item.code"
      @update="saveEdit(item, $event)"
      @cancel-edit="editingCode = null"
    >
      <template #menu>
        <q-item v-if="childCounts[item.code] > 0" clickable :to="`/${owner}/${projectId}/thread/${item.code}`">
          <q-item-section>자식 항목 보기 ({{ childCounts[item.code] }})</q-item-section>
        </q-item>
        <q-item v-if="canMarkRead(item)" clickable :disable="busy === item.code" @click="markRead(item)">
          <q-item-section>확인함</q-item-section>
        </q-item>
        <q-item v-if="canAnswer(item)" clickable @click="openAnswerComposer(item)">
          <q-item-section>답변 작성</q-item-section>
        </q-item>
        <q-item v-if="canEditItem(item)" clickable @click="editingCode = item.code">
          <q-item-section>수정</q-item-section>
        </q-item>
        <q-item v-if="canDiscard(item)" clickable @click="discardItem(item)">
          <q-item-section class="text-negative">폐기</q-item-section>
        </q-item>
      </template>

      <DiscussionItemCard
        v-if="item.kind !== 'OP' && item.answer"
        :code="item.answer.code"
        kind="AN"
        :title="item.answer.title"
        :state="item.answer.state"
        :author="item.answer.author"
        :content="item.answer.content"
        :error="actionError[item.answer.code]"
        :has-menu="hasAnswerMenu(item.answer)"
        avatar-size="var(--gh-avatar-sm)"
        padding-class="q-pa-sm q-mt-sm"
        style="background: var(--gh-canvas-subtle)"
      >
        <template #menu>
          <q-item v-if="childCounts[item.answer.code] > 0" clickable :to="`/${owner}/${projectId}/thread/${item.answer.code}`">
            <q-item-section>자식 항목 보기 ({{ childCounts[item.answer.code] }})</q-item-section>
          </q-item>
          <q-item v-if="canMarkAnswerRead(item.answer)" clickable :disable="busy === item.answer.code" @click="markAnswerRead(item.answer!)">
            <q-item-section>확인함</q-item-section>
          </q-item>
          <q-item v-if="canMarkAnswerDone(item.answer)" clickable :disable="busy === item.answer.code" @click="markAnswerDone(item.answer!)">
            <q-item-section>완료 처리</q-item-section>
          </q-item>
        </template>
        <FollowUpComposer :owner="owner" :project-id="projectId" :parent-code="item.answer.code" @created="load" />
      </DiscussionItemCard>

      <q-slide-transition>
        <div v-if="answeringCode === item.code" class="q-mt-sm">
          <MarkdownSourceView ref="answerEditorRef" content="" start-in-edit hide-toolbar :edit-min-height="200" />
          <div v-if="answerError" class="text-negative text-caption q-mt-xs">{{ answerError }}</div>
          <div class="row justify-end q-gutter-sm q-mt-sm">
            <q-btn flat label="취소하기" @click="closeAnswerComposer" />
            <q-btn color="primary" label="등록하기" :loading="answering" @click="submitAnswer" />
          </div>
        </div>
      </q-slide-transition>

      <!-- 설계자 요청(2026-09-22 후속) - 질문/답변/의견 항목 각각에 "추가
           질문"/"추가 의견"을 달 수 있어야 한다(문서 전체가 아니라 그
           항목 하나를 부모로) - question/opinion은 부모 타입 제한이 없어
           (documentRules.ts) 이미 백엔드가 지원하던 걸 창구만 새로 연다. -->
      <FollowUpComposer :owner="owner" :project-id="projectId" :parent-code="item.code" @created="load" />
    </DiscussionItemCard>

    <!-- 설계자 요청(2026-09-21) - 문서 전체에 질문하기/의견 남기기(항목이
         아니라 이 문서 자체가 부모). -->
    <FollowUpComposer :owner="owner" :project-id="projectId" :parent-code="parentCode" ask-label="질문하기" opinion-label="의견 남기기" @created="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from "vue";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import DiscussionItemCard from "components/DiscussionItemCard.vue";
import FollowUpComposer from "components/FollowUpComposer.vue";
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

const props = defineProps<{ owner: string; projectId: string; parentCode: string; highlightCode?: string }>();
const auth = useAuthStore();

const loading = ref(true);
const questions = ref<DocFull[]>([]);
const answers = ref<DocFull[]>([]);
const opinions = ref<DocFull[]>([]);
const busy = ref<string | null>(null);
const actionError = reactive<Record<string, string>>({});
const childCounts = reactive<Record<string, number>>({});
// answeringCode와 같은 패턴 - 한 번에 최대 하나의 카드만 편집 모드로 켠다.
const editingCode = ref<string | null>(null);

const thread = computed<ThreadItem[]>(() => {
  const qItems: ThreadItem[] = questions.value.map((q) => ({
    ...q,
    answer: answers.value.find((a) => a.parent_id === parseIdFromCode(q.code)) ?? null,
  }));
  const oItems: ThreadItem[] = opinions.value.map((o) => ({ ...o, answer: null }));
  return [...qItems, ...oItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
});

// 설계자 요청(2026-09-21 후속) - documentRules.ts의 checkTransition을
// 그대로 옮긴 UI 힌트(실제 허용 여부는 언제나 서버가 최종 판단한다) -
// more 메뉴에 뭘 보여줄지 여기 조건 하나로만 결정한다.
function canMarkRead(item: ThreadItem): boolean {
  return item.kind !== "OP" && item.author === "agent" && item.state === "added";
}
function canAnswer(item: ThreadItem): boolean {
  return item.kind !== "OP" && item.author === "agent" && item.state === "read" && !item.answer;
}
// question의 discard는 "질의자 본인만, 미해소 상태에서만"(documentRules.ts) -
// architect가 재질의하기로 만든 질문(author==='architect')만 여기서
// architect가 스스로 거둘 수 있다. opinion의 discard는 늘 architect
// 본인이 쓴 것이므로(opinion은 architect만 등록 가능) 조건이 더 단순하다.
function canDiscard(item: ThreadItem): boolean {
  if (item.state !== "added" && item.state !== "read") return false;
  if (item.kind === "OP") return true;
  return item.author === "architect";
}
// 설계자 요청(2026-09-23) - "question이나 opinion들에서 아직 확인전인
// 것들은 수정을 할 수 있어야해" - backend documents.ts의 docsUpdate가
// 실제로 강제하는 규칙(작성자 본인 + added 상태)을 그대로 UI 힌트로
// 반영한다(다른 게이트들과 같은 원칙 - 실제 허용 여부는 언제나 서버가
// 최종 판단). 웹 UI는 항상 architect 채널이므로 architect가 쓴
// question/opinion만 대상이다.
function canEditItem(item: ThreadItem): boolean {
  return (item.kind === "QU" || item.kind === "OP") && item.author === "architect" && item.state === "added";
}
// 설계자 요청(2026-09-21 후속) - "완료 처리"는 지금까지 웹 UI에 전혀
// 없던 액션이었다(질문->답변 스레드가 done에 도달할 방법이 없었다) -
// answer의 done 전이는 "질의자(=그 answer 작성자의 반대 채널)만" 가능
// 하므로, WEB UI(=architect)가 누를 수 있는 경우는 answer.author==='agent'
// 일 때뿐이다(architect가 재질의한 질문에 agent가 답한 경우).
// 버그(2026-09-21 재발견) - "완료 처리"(read->done)만 넣고 그 앞 단계인
// added->read를 빼먹었었다 - documentRules.ts상 이 read 전이도 마찬가지로
// "질의자(=answer 작성자의 반대 채널)"만 할 수 있어서, answer.author==='agent'
// 인 경우 architect(WEB UI)가 직접 눌러줘야만 상태가 read로 넘어가고,
// 그래야 비로소 "완료 처리"가 나타난다 - 이 액션 없이는 "완료 처리" 자체가
// 영원히 도달 불가능한 죽은 기능이었다.
function canMarkAnswerRead(answer: DocFull): boolean {
  return answer.author === "agent" && answer.state === "added";
}
function canMarkAnswerDone(answer: DocFull): boolean {
  return answer.author === "agent" && answer.state === "read";
}
function hasItemMenu(item: ThreadItem): boolean {
  return (childCounts[item.code] ?? 0) > 0 || canMarkRead(item) || canAnswer(item) || canEditItem(item) || canDiscard(item);
}
function hasAnswerMenu(answer: DocFull): boolean {
  return (childCounts[answer.code] ?? 0) > 0 || canMarkAnswerRead(answer) || canMarkAnswerDone(answer);
}

// backend/src/core/documents.ts의 docsList가 payload.parentId를 Document.parentId
// 컬럼(원문 id) 그대로 필터링해준다 - 추적 코드가 아니라 id를 넘겨야 한다.
// 설계자 지적(2026-09-22 후속, "레이턴시가 너무 높아") - 예전엔 목록을
// 받은 뒤 항목마다 docs.get을 또 불러 본문을 채웠다(N+1 - 실기동으로
// 스레드 하나에 항목 20개면 왕복 20번이 추가로 나가는 것 확인, 브라우저
// 호스트당 동시 연결 제한에 걸려 체감 지연이 초 단위로 불어남).
// includeContent: true로 목록 조회 한 번에 본문까지 받는다.
async function loadDocsByParent(type: string, parentId: string): Promise<DocFull[]> {
  const listResult = await api.listDocuments(auth.apiKey!, props.owner, props.projectId, { type, parentId, includeContent: true });
  if (!listResult.ok) return [];
  return (listResult.data as { items: DocFull[] }).items;
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
  const listResult = await api.listDocuments(auth.apiKey!, props.owner, props.projectId, { type: "answer", includeContent: true });
  if (!listResult.ok) return [];
  return (listResult.data as { items: DocFull[] }).items;
}

// design-notes.md 후속 판단(설계자 요청, 2026-09-21) - Q&A는 실제로는
// 계층 구조(질문->답변->그 답변에 대한 재질의->...)인데 이 스레드 카드는
// 딱 한 단계(질문+직접 답변)만 보여준다. 카드마다(질문/답변 각각) 그
// "표시된 것 이상의" 자식이 있는지 세어뒀다가 more 메뉴에 조건부로
// 넣는다 - 질문 카드는 이미 보여준 직접 답변 자신은 자식 수에서 뺀다.
// 설계자 지적(2026-09-22 후속, "레이턴시가 너무 높아") - 항목 하나당
// docs.list({parentId}) 호출을 따로 불렀다(N+1 - 스레드 하나에 항목
// 20개면 왕복 20번, 브라우저 동시 연결 제한에 걸려 체감 지연이 초
// 단위로 불어남). docs.childCounts로 한 번에 그룹 집계한다 - "이미
// 보여준 직접 답변"은 그 답변이 있는지 자체로 이미 알고 있으니(별도
// 코드 비교 없이) 개수에서 그만큼만 빼면 된다.
async function loadChildCounts() {
  const targets: { code: string; excludeCount: number }[] = [];
  for (const item of thread.value) {
    targets.push({ code: item.code, excludeCount: item.answer ? 1 : 0 });
    if (item.answer) targets.push({ code: item.answer.code, excludeCount: 0 });
  }
  if (targets.length === 0) return;
  const rawIds = targets.map((t) => parseIdFromCode(t.code));
  const result = await api.getChildCounts(auth.apiKey!, props.owner, props.projectId, rawIds);
  if (!result.ok) return;
  const counts = (result.data as { counts: Record<string, number> }).counts;
  for (const t of targets) {
    childCounts[t.code] = Math.max(0, (counts[parseIdFromCode(t.code)] ?? 0) - t.excludeCount);
  }
}

async function markRead(item: ThreadItem) {
  busy.value = item.code;
  actionError[item.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.code, "read", item.state);
  busy.value = null;
  if (!result.ok) {
    actionError[item.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markAnswerRead(answer: DocFull) {
  busy.value = answer.code;
  actionError[answer.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, answer.code, "read", answer.state);
  busy.value = null;
  if (!result.ok) {
    actionError[answer.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

async function markAnswerDone(answer: DocFull) {
  busy.value = answer.code;
  actionError[answer.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, answer.code, "done", answer.state);
  busy.value = null;
  if (!result.ok) {
    actionError[answer.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
}

const answeringCode = ref<string | null>(null);
// 버그(2026-09-21 후속 발견) - 이 ref가 붙는 MarkdownSourceView는
// `v-for="item in thread"` 루프 "안"에 있다 - Vue는 v-for 내부의
// 같은 이름 ref를 항상 배열로 모은다(공식 문서에 명시된 동작인데
// 이 컴포저를 작성할 때 놓쳤다). 그동안 `answerEditorRef.value`를
// 단일 객체로 취급해 `.getMarkdown()`을 직접 불렀는데, 실제로는
// 배열이라 그 호출이 항상 예외를 던졌다 - 즉 "답변 작성" 버튼을
// 눌러 실제로 등록을 시도하면(이 컴포넌트를 쓰는 Documents/Plans/
// Issues/Trackers/Tests 전부) 항상 조용히 실패했다(uncaught promise
// rejection이라 화면에 에러 메시지도 안 뜨고 로딩 스피너만 영원히
// 돌았다). `answeringCode`가 한 번에 최대 하나만 가리키므로 실제
// DOM에는 이 ref를 가진 인스턴스가 0개 또는 1개만 존재한다 - 배열
// 타입으로 바로잡고 `[0]`으로 접근한다.
const answerEditorRef = ref<MarkdownSourceViewRef[]>([]);
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
  const result = await api.createDocument(auth.apiKey!, props.owner, props.projectId, {
    type: "answer",
    kind: "AN",
    parentId: question.code,
    title: `Re: ${question.title}`,
    content: answerEditorRef.value?.[0]?.getMarkdown() ?? "",
  });
  answering.value = false;
  if (!result.ok) {
    answerError.value = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  answeringCode.value = null;
  await load();
}

async function saveEdit(item: ThreadItem, markdown: string) {
  actionError[item.code] = "";
  const result = await api.updateDocument(auth.apiKey!, props.owner, props.projectId, item.code, { etag: item.etag, content: markdown });
  if (!result.ok) {
    actionError[item.code] = result.reason?.join(", ") ?? "수정에 실패했습니다.";
    return;
  }
  editingCode.value = null;
  await load();
}

async function discardItem(item: ThreadItem) {
  actionError[item.code] = "";
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, item.code, "discard", item.state);
  if (!result.ok) {
    actionError[item.code] = result.reason?.join(", ") ?? "실패했습니다.";
    return;
  }
  await load();
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
