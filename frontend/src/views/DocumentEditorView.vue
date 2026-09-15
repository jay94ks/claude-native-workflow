<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import MarkdownBody from "../components/MarkdownBody.vue";
import UserRef from "../components/UserRef.vue";
import QAPanel from "../components/QAPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useEntityPickerStore } from "../stores/entityPicker";
import { useTargetPanelDialogStore } from "../stores/targetPanelDialog";
import { useFolderPickerStore } from "../stores/folderPicker";
import { useToastStore } from "../stores/toast";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string; trackingCode: string }>();
const router = useRouter();
const entityPicker = useEntityPickerStore();
const targetPanelDialog = useTargetPanelDialogStore();
const folderPicker = useFolderPickerStore();
const toast = useToastStore();
const activeTab = ref<"view" | "chapters" | "qa" | "qa-history">("view");

// 메시지로 지시는 문서 자체 권한이 아니라 프로젝트 editor 이상(백엔드
// POST .../messages가 requireProjectRole("editor")) - 편집/저장/삭제/
// 전이/소스연결은 doc.perm(문서별 세부 권한, resolveEffectivePermission
// 결과)을 그대로 쓴다.
const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canSendInstruction = computed(() => roleSatisfies(myRole.value, "editor"));

interface DocumentLinkOutItem {
  trackingCode: string;
  title: string;
  linkType: string | null;
  order: number;
}
interface DocumentBacklinkItem {
  trackingCode: string;
  title: string;
}
interface DocumentDetail {
  trackingCode: string;
  title: string;
  body: string;
  statusCode: string;
  priority: number | null;
  createdBy: string;
  linksOut: DocumentLinkOutItem[];
  backlinks: DocumentBacklinkItem[];
  perm: { read: boolean; write: boolean; delete: boolean };
  notices?: string[];
}

// review/pending은 문서 상태(statusCode)의 표준 코드 - Q&A의 별개
// "pending"(질문 상태)과는 무관.
const PRIORITY_EDITABLE_STATUSES = new Set(["review", "pending"]);
interface NextStatus {
  code: string;
  label: string;
  guideline: string | null;
}
interface SourceLink {
  id: string;
  filePath: string;
}
interface BranchLink {
  id: string;
  branchName: string;
}
interface ChapterInfo {
  ordinal: number;
  level: number;
  heading: string;
  lineStart: number;
  lineEnd: number;
}
interface ChapterMutationResult {
  chapters: ChapterInfo[];
}

const doc = ref<DocumentDetail | null>(null);
const body = ref("");
const loading = ref(true);
const error = ref("");
const saving = ref(false);
const saveMessage = ref("");
const mode = ref<"read" | "edit">("read");

const nextStatuses = ref<NextStatus[]>([]);
const toStatusCode = ref("");
const transitionError = ref("");

const priorityInput = ref<string | number>("");
const priorityError = ref("");
const savingPriority = ref(false);

const sourceLinks = ref<SourceLink[]>([]);
const sourceLinksError = ref("");
const newSourcePath = ref("");

const branchLinks = ref<BranchLink[]>([]);
const branchLinksError = ref("");
const newBranchName = ref("");

const deleting = ref(false);
const deleteError = ref("");

const messageDraft = ref("");
const messageOpen = ref(false);
const messageSending = ref(false);
const messageError = ref("");
const messageSent = ref(false);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 문서 목록 화면에서 방금 만든 문서로 바로 넘어오면, DB 커밋은 끝났어도
// Meilisearch 색인 반영이 몇백 ms 지연될 수 있어(Phase 0 검증 때도
// 관찰한 일시적 현상 - 재조회하면 항상 해결됨) 404가 뜰 수 있다. 한 번만
// 짧게 대기 후 재시도한다 - 그래도 안 되면 진짜 에러로 보여준다.
async function fetchDocument(retryOn404: boolean): Promise<DocumentDetail> {
  try {
    return await apiCall<DocumentDetail>(`/documents/${props.trackingCode}`);
  } catch (err) {
    if (retryOn404 && err instanceof ApiError && err.status === 404) {
      await sleep(500);
      return fetchDocument(false);
    }
    throw err;
  }
}

async function loadNextStatuses() {
  try {
    nextStatuses.value = await apiCall<NextStatus[]>(`/documents/${props.trackingCode}/next-statuses`);
  } catch {
    nextStatuses.value = [];
  }
}

async function loadSourceLinks() {
  try {
    sourceLinks.value = await apiCall<SourceLink[]>(`/documents/${props.trackingCode}/source-links`);
  } catch {
    sourceLinks.value = [];
  }
}

async function addSourceLink() {
  const filePath = newSourcePath.value.trim();
  if (!filePath) return;
  sourceLinksError.value = "";
  try {
    await apiCall(`/documents/${props.trackingCode}/source-links`, {
      method: "POST",
      body: JSON.stringify({ filePath }),
    });
    newSourcePath.value = "";
    await loadSourceLinks();
  } catch (err) {
    sourceLinksError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
  }
}

async function pickSourceLink() {
  const result = await entityPicker.pick({
    kind: "sourceFile",
    projectId: props.id,
    multi: false,
    allowManualEntry: true,
  });
  if (result && result[0]) {
    newSourcePath.value = result[0];
    await addSourceLink();
  }
}

async function removeSourceLink(id: string) {
  sourceLinksError.value = "";
  try {
    await apiCall(`/document-source-links/${id}?trackingCode=${encodeURIComponent(props.trackingCode)}`, { method: "DELETE" });
    await loadSourceLinks();
  } catch (err) {
    sourceLinksError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  }
}

function openSourceFile(filePath: string) {
  router.push(`/projects/${props.id}/source?path=${encodeURIComponent(filePath)}`);
}

function openRelatedDocument(trackingCode: string) {
  router.push(`/projects/${props.id}/documents/${trackingCode}`);
}

async function loadBranchLinks() {
  try {
    branchLinks.value = await apiCall<BranchLink[]>(`/documents/${props.trackingCode}/branch-links`);
  } catch {
    branchLinks.value = [];
  }
}

async function addBranchLink() {
  const branchName = newBranchName.value.trim();
  if (!branchName) return;
  branchLinksError.value = "";
  try {
    await apiCall(`/documents/${props.trackingCode}/branch-links`, {
      method: "POST",
      body: JSON.stringify({ branchName }),
    });
    newBranchName.value = "";
    await loadBranchLinks();
  } catch (err) {
    branchLinksError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
  }
}

async function removeBranchLink(id: string) {
  branchLinksError.value = "";
  try {
    await apiCall(`/document-branch-links/${id}?trackingCode=${encodeURIComponent(props.trackingCode)}`, { method: "DELETE" });
    await loadBranchLinks();
  } catch (err) {
    branchLinksError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    doc.value = await fetchDocument(true);
    body.value = doc.value.body;
    priorityInput.value = doc.value.priority === null ? "" : String(doc.value.priority);
    mode.value = "read";
    await Promise.all([loadNextStatuses(), loadSourceLinks(), loadBranchLinks(), loadFavorite()]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- 즐겨찾기(#document-favorites)

const favorited = ref(false);
const favoriteToggling = ref(false);

async function loadFavorite() {
  try {
    const result = await apiCall<{ favorited: boolean }>(`/documents/${props.trackingCode}/favorite`);
    favorited.value = result.favorited;
  } catch {
    favorited.value = false;
  }
}

async function toggleFavorite() {
  if (favoriteToggling.value) return;
  const next = !favorited.value;
  favoriteToggling.value = true;
  try {
    await apiCall(`/documents/${props.trackingCode}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorited: next }),
    });
    favorited.value = next;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "즐겨찾기 변경에 실패했습니다";
  } finally {
    favoriteToggling.value = false;
  }
}

// ---------------------------------------------------------------- 챕터(헤딩 섹션) CRUD(#document-chapters)
// 백엔드는 CLI/MCP 전용으로 먼저 나왔고(설계자 지시 "클로드가 호출"),
// 이번에 웹 에디터에도 붙인다. 한 번에 챕터 하나만 편집/추가 폼을
// 열 수 있게 한다(아코디언 - 여러 개를 동시에 열면 어느 걸 저장했을
// 때 다른 편집 중인 내용의 lineStart/lineEnd가 밀려 꼬일 수 있어서).
// 챕터를 쓰면(교체/삽입/삭제) 그 자리에서 받은 최신 chapters 배열로
// 목록만 갱신하고, "보기"/"편집" 탭이 보는 doc.body/body도 같이
// 새로고침해 두 탭이 항상 같은 내용을 보게 한다.

const chapters = ref<ChapterInfo[]>([]);
const chaptersLoading = ref(false);
const chaptersError = ref("");
const chaptersLoaded = ref(false);

const editingChapterOrdinal = ref<number | null>(null);
const editingChapterContent = ref("");
const editingChapterLoading = ref(false);
const editingChapterSaving = ref(false);
const editingChapterError = ref("");

const addingChapter = ref(false);
const addChapterContent = ref("");
const addChapterPosition = ref<"atStart" | "atEnd" | "after" | "before">("atEnd");
const addChapterRelativeOrdinal = ref<number | "">("");
const addChapterSaving = ref(false);
const addChapterError = ref("");

function chapterLabel(c: ChapterInfo): string {
  return c.heading || (c.level === 0 ? "(제목 없음)" : `(제목 없는 ${"#".repeat(c.level)} 헤딩)`);
}

async function loadChapters() {
  chaptersLoading.value = true;
  chaptersError.value = "";
  try {
    chapters.value = await apiCall<ChapterInfo[]>(`/documents/${props.trackingCode}/chapters`);
    chaptersLoaded.value = true;
  } catch (err) {
    chaptersError.value = err instanceof ApiError ? err.message : "챕터 목록을 불러오지 못했습니다";
  } finally {
    chaptersLoading.value = false;
  }
}

// 챕터를 쓴 뒤 doc.body/body(보기·편집 탭용)도 최신화 - 재조회는
// fetchDocument()의 404 재시도 없이 바로(이미 존재이 확인된 문서라).
async function refreshDocumentBody() {
  try {
    const updated = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}`);
    if (doc.value) doc.value = { ...doc.value, ...updated };
    if (mode.value === "read") body.value = updated.body;
  } catch {
    // 챕터 자체는 이미 반영됐으니, 본문 새로고침 실패는 조용히 무시
    // (다음 탭 전환/새로고침 때 자연스럽게 맞음).
  }
}

function openChapterTab() {
  activeTab.value = "chapters";
  if (!chaptersLoaded.value) loadChapters();
}

async function startEditChapter(ordinal: number) {
  addingChapter.value = false;
  editingChapterOrdinal.value = ordinal;
  editingChapterContent.value = "";
  editingChapterError.value = "";
  editingChapterLoading.value = true;
  try {
    const result = await apiCall<{ chapter: ChapterInfo; content: string }>(`/documents/${props.trackingCode}/chapters/${ordinal}`);
    editingChapterContent.value = result.content;
  } catch (err) {
    editingChapterError.value = err instanceof ApiError ? err.message : "챕터 내용을 불러오지 못했습니다";
  } finally {
    editingChapterLoading.value = false;
  }
}

function cancelEditChapter() {
  editingChapterOrdinal.value = null;
  editingChapterContent.value = "";
  editingChapterError.value = "";
}

async function saveEditChapter() {
  if (editingChapterOrdinal.value === null) return;
  editingChapterSaving.value = true;
  editingChapterError.value = "";
  try {
    const result = await apiCall<ChapterMutationResult>(`/documents/${props.trackingCode}/chapters/${editingChapterOrdinal.value}`, {
      method: "PUT",
      body: JSON.stringify({ content: editingChapterContent.value }),
    });
    chapters.value = result.chapters;
    cancelEditChapter();
    await refreshDocumentBody();
  } catch (err) {
    editingChapterError.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    editingChapterSaving.value = false;
  }
}

async function deleteChapter(ordinal: number) {
  const chapter = chapters.value.find((c) => c.ordinal === ordinal);
  const confirmed = window.confirm(`"${chapter ? chapterLabel(chapter) : ordinal}" 챕터를 삭제하시겠습니까?`);
  if (!confirmed) return;
  chaptersError.value = "";
  try {
    const result = await apiCall<ChapterMutationResult>(`/documents/${props.trackingCode}/chapters/${ordinal}`, { method: "DELETE" });
    chapters.value = result.chapters;
    if (editingChapterOrdinal.value === ordinal) cancelEditChapter();
    await refreshDocumentBody();
  } catch (err) {
    chaptersError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  }
}

function startAddChapter() {
  cancelEditChapter();
  addingChapter.value = true;
  addChapterContent.value = "";
  addChapterPosition.value = "atEnd";
  addChapterRelativeOrdinal.value = "";
  addChapterError.value = "";
}

function cancelAddChapter() {
  addingChapter.value = false;
}

async function saveAddChapter() {
  if (!addChapterContent.value.trim()) return;
  if ((addChapterPosition.value === "after" || addChapterPosition.value === "before") && addChapterRelativeOrdinal.value === "") {
    addChapterError.value = "기준 챕터 번호를 입력하세요";
    return;
  }
  addChapterSaving.value = true;
  addChapterError.value = "";
  try {
    const payload: Record<string, unknown> = { content: addChapterContent.value };
    if (addChapterPosition.value === "atStart") payload.atStart = true;
    else if (addChapterPosition.value === "atEnd") payload.atEnd = true;
    else if (addChapterPosition.value === "after") payload.after = Number(addChapterRelativeOrdinal.value);
    else if (addChapterPosition.value === "before") payload.before = Number(addChapterRelativeOrdinal.value);
    const result = await apiCall<ChapterMutationResult>(`/documents/${props.trackingCode}/chapters`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    chapters.value = result.chapters;
    addingChapter.value = false;
    await refreshDocumentBody();
  } catch (err) {
    addChapterError.value = err instanceof ApiError ? err.message : "추가에 실패했습니다";
  } finally {
    addChapterSaving.value = false;
  }
}

// QAPanel에서 답변으로 인한 자동 상태 전이가 일어났을 때만 씀 - 전체
// load()는 loading 플래그를 다시 세워 화면을 통째로 숨기고 편집 중인
// body도 서버 값으로 덮어써버리므로, 상단 상태 배지만 조용히 갱신한다.
// QAPanel의 답변 API 응답에 이미 새 상태 코드가 있으니 재조회하지 않고
// 그대로 받아쓴다(재조회하면 Meilisearch 색인 반영 지연으로 옛 상태가
// 잠깐 다시 보일 수 있음 - fetchDocument의 재시도 패턴과 같은 원인).
function refreshStatus(statusCode: string) {
  if (doc.value) doc.value.statusCode = statusCode;
  loadNextStatuses();
}

function startEdit() {
  if (!doc.value) return;
  body.value = doc.value.body;
  saveMessage.value = "";
  mode.value = "edit";
}

function cancelEdit() {
  if (doc.value) body.value = doc.value.body;
  mode.value = "read";
}

async function save() {
  saving.value = true;
  saveMessage.value = "";
  error.value = "";
  try {
    // transition()/savePriority()와 같은 이유로 병합(본문 저장 응답에도
    // perm이 없음).
    const updated = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}`, {
      method: "PUT",
      body: JSON.stringify({ body: body.value }),
    });
    doc.value = doc.value ? { ...doc.value, ...updated } : updated;
    saveMessage.value = "저장됨";
    mode.value = "read";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function onPickFolder() {
  const result = await folderPicker.pick(props.id);
  if (result === undefined) return; // 취소
  error.value = "";
  try {
    await apiCall(`/documents/${props.trackingCode}/folder`, {
      method: "PUT",
      body: JSON.stringify({ folderId: result }),
    });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 변경에 실패했습니다";
  }
}

async function transition() {
  if (!toStatusCode.value) return;
  transitionError.value = "";
  try {
    // 전이 응답엔 perm이 없다(GET 단건 조회만 얹어줌) - 통째로
    // 바꿔치면 doc.perm이 undefined가 돼 툴바의 v-if="doc.perm.write"
    // 가 깨진다(실측 중 발견). 기존 doc 위에 병합해 perm을 보존한다.
    const updated = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatusCode: toStatusCode.value }),
    });
    doc.value = doc.value ? { ...doc.value, ...updated } : updated;
    toStatusCode.value = "";
    await loadNextStatuses();
  } catch (err) {
    transitionError.value = err instanceof ApiError ? err.message : "상태 전이에 실패했습니다";
  }
}

async function savePriority() {
  // v-model이 type="number" 입력에는 값을 문자열이 아니라 숫자로
  // 자동 캐스팅한다(Vue 3 - .number 수식어 없이도) - 그래서 빈 값이면
  // ""(문자열)로 남고, 뭔가 입력되면 숫자로 바뀐다. 둘 다 안전하게
  // 처리한다.
  const raw = priorityInput.value;
  const priority = Number(raw);
  if (raw === "" || !Number.isInteger(priority)) {
    priorityError.value = "정수를 입력하세요";
    return;
  }
  savingPriority.value = true;
  priorityError.value = "";
  try {
    // transition()과 같은 이유로 병합(priority 응답에도 perm이 없음).
    const updated = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}/priority`, {
      method: "PUT",
      body: JSON.stringify({ priority }),
    });
    doc.value = doc.value ? { ...doc.value, ...updated } : updated;
  } catch (err) {
    priorityError.value = err instanceof ApiError ? err.message : "우선순위 저장에 실패했습니다";
  } finally {
    savingPriority.value = false;
  }
}

async function remove() {
  if (!doc.value) return;
  const confirmed = window.confirm(
    `"${doc.value.title}"(${props.trackingCode}) 문서를 삭제하시겠습니까?\n리비전 이력, 링크, 코멘트, 질의/답변이 모두 함께 삭제되며 되돌릴 수 없습니다.`,
  );
  if (!confirmed) return;
  deleting.value = true;
  deleteError.value = "";
  try {
    await apiCall(`/documents/${props.trackingCode}`, { method: "DELETE" });
    router.push(`/projects/${props.id}/documents`);
  } catch (err) {
    deleteError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
    deleting.value = false;
  }
}

async function sendInstructionMessage() {
  if (!messageDraft.value.trim()) return;
  messageSending.value = true;
  messageError.value = "";
  try {
    await apiCall(`/projects/${props.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: `[${props.trackingCode}] ${messageDraft.value.trim()}` }),
    });
    messageDraft.value = "";
    messageOpen.value = false;
    messageSent.value = true;
    setTimeout(() => (messageSent.value = false), 3000);
  } catch (err) {
    messageError.value = err instanceof ApiError ? err.message : "전송에 실패했습니다";
  } finally {
    messageSending.value = false;
  }
}

const selectedNextStatusGuideline = computed(() => nextStatuses.value.find((s) => s.code === toStatusCode.value)?.guideline ?? null);

// 사이드바 문서 탐색기에서 다른 문서를 클릭하면 같은 라우트
// (/projects/:id/documents/:trackingCode)라 Vue Router가 컴포넌트
// 인스턴스를 재사용한다 - onMounted가 다시 안 불려서 trackingCode만
// 바뀐 채 이전 문서 내용이 그대로 남아있던 버그(URL은 바뀌는데 화면은
// 안 바뀜)를 여기서 잡는다. 편집/전이/우선순위/소스연결/지시 메시지
// 관련 임시 상태도 이전 문서 것이 새 문서로 새어 들어가지 않도록
// 같이 초기화한다.
watch(
  () => props.trackingCode,
  () => {
    activeTab.value = "view";
    toStatusCode.value = "";
    transitionError.value = "";
    priorityError.value = "";
    sourceLinksError.value = "";
    newSourcePath.value = "";
    deleteError.value = "";
    saveMessage.value = "";
    messageDraft.value = "";
    messageOpen.value = false;
    messageError.value = "";
    messageSent.value = false;
    chapters.value = [];
    chaptersLoaded.value = false;
    chaptersError.value = "";
    cancelEditChapter();
    cancelAddChapter();
    load();
  },
);
onMounted(load);

// 지금 읽고 있는 문서가 다른 세션에서 개정되거나 새 질의가 등록되면
// 토스트로 알려준다(#realtime-toast) - 이 화면은 QAPanel.vue와 달리
// 지금까지 실시간 구독 자체가 없었다. props.trackingCode를 핸들러
// 안에서 직접 참조하므로(클로저에 값을 미리 담지 않음) 사이드바에서
// 다른 문서로 이동해 컴포넌트가 재사용돼도 항상 "지금 보고 있는"
// 문서 기준으로 정확히 걸러진다. 자동 새로고침은 하지 않는다 - 편집
// 중인 내용을 조용히 덮어쓰면 더 위험하다.
let disconnectRealtime: (() => void) | null = null;
onMounted(async () => {
  disconnectRealtime = await connectProjectRealtime(props.id, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "document" && event.action === "update" && event.trackingCode === props.trackingCode) {
        toast.push("문서가 개정되었습니다.");
      } else if (
        event.entity === "question" &&
        event.action === "create" &&
        event.targetType === "document" &&
        event.targetKey === props.trackingCode
      ) {
        toast.push("새 질의가 등록되었습니다.");
      }
    },
  });
});
onUnmounted(() => disconnectRealtime?.());
</script>

<template>
  <p v-if="loading">불러오는 중...</p>
  <p v-else-if="error && !doc" class="error">{{ error }}</p>
  <template v-else-if="doc">
    <div class="document-editor">
      <div class="header">
        <div>
          <code>{{ doc.trackingCode }}</code>
          <h1>{{ doc.title }}</h1>
          <div class="meta">작성자 <UserRef :user-id="doc.createdBy" /></div>
        </div>
        <div class="actions">
          <span v-if="doc.priority !== null" class="priority-badge">우선순위 {{ doc.priority }}</span>
          <StatusBadge :code="doc.statusCode" />
        </div>
      </div>
  
      <div v-if="doc.notices && doc.notices.length > 0" class="notice-banner">
        <p v-for="(n, i) in doc.notices" :key="i">⚠ {{ n }}</p>
      </div>
  
      <div class="tabs">
        <button :class="{ active: activeTab === 'view' }" @click="activeTab = 'view'">보기</button>
        <button :class="{ active: activeTab === 'chapters' }" @click="openChapterTab">챕터</button>
        <button :class="{ active: activeTab === 'qa' }" @click="activeTab = 'qa'">질의/답변</button>
        <button :class="{ active: activeTab === 'qa-history' }" @click="activeTab = 'qa-history'">답변 기록</button>
        <span class="spacer"></span>
        <button
          type="button"
          class="star-btn"
          :class="{ active: favorited }"
          :disabled="favoriteToggling"
          :title="favorited ? '즐겨찾기 해제' : '즐겨찾기 추가'"
          @click="toggleFavorite"
        >
          {{ favorited ? "★" : "☆" }}
        </button>
        <button class="secondary" @click="onPickFolder">폴더</button>
        <button
          class="secondary"
          @click="targetPanelDialog.show('comments', id, 'document', trackingCode)"
        >
          코멘트
        </button>
      </div>
  
      <template v-if="activeTab === 'view'">
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="saveMessage" class="saved">{{ saveMessage }}</p>
        <p v-if="messageSent" class="saved">메시지를 보냈습니다.</p>
  
        <div class="toolbar">
          <template v-if="doc.perm.write">
            <select v-model="toStatusCode">
              <option value="">상태 전이...</option>
              <option v-for="s in nextStatuses" :key="s.code" :value="s.code">{{ s.label }}</option>
            </select>
            <button class="secondary" :disabled="!toStatusCode" @click="transition">전이</button>
            <span v-if="transitionError" class="error">{{ transitionError }}</span>
          </template>
  
          <template v-if="doc.perm.write && PRIORITY_EDITABLE_STATUSES.has(doc.statusCode)">
            <input v-model="priorityInput" type="number" step="1" class="priority-input" placeholder="우선순위" />
            <button class="secondary" :disabled="savingPriority" @click="savePriority">
              {{ savingPriority ? "저장 중..." : "우선순위 저장" }}
            </button>
            <span v-if="priorityError" class="error">{{ priorityError }}</span>
          </template>
  
          <span class="spacer"></span>
  
          <button v-if="mode === 'read' && canSendInstruction" class="secondary" @click="messageOpen = !messageOpen">메시지로 지시</button>
          <button v-if="mode === 'read' && doc.perm.write" class="secondary" @click="startEdit">편집</button>
          <button v-if="mode === 'read' && doc.perm.delete" class="danger" :disabled="deleting" @click="remove">
            {{ deleting ? "삭제 중..." : "삭제" }}
          </button>
        </div>
        <p v-if="selectedNextStatusGuideline" class="guideline-hint">{{ selectedNextStatusGuideline }}</p>
        <p v-if="deleteError" class="error">{{ deleteError }}</p>
  
        <div v-if="messageOpen" class="message-compose">
          <textarea v-model="messageDraft" rows="2" :placeholder="`[${trackingCode}] 지시할 내용을 입력...`"></textarea>
          <div class="message-actions">
            <button :disabled="messageSending" @click="sendInstructionMessage">전송</button>
            <button type="button" class="secondary" @click="messageOpen = false">취소</button>
          </div>
          <p v-if="messageError" class="error">{{ messageError }}</p>
        </div>
  
        <template v-if="mode === 'read'">
          <MarkdownBody :body="doc.body" class="body-view" />
        </template>
        <template v-else>
          <MonacoEditor v-model="body" language="markdown" class="editor" />
          <div class="edit-actions">
            <button :disabled="saving" @click="save">{{ saving ? "저장 중..." : "저장" }}</button>
            <button type="button" class="secondary" @click="cancelEdit">취소</button>
          </div>
        </template>
  
        <section class="source-links">
          <h2>연관 문서</h2>
          <p class="related-doc-group-label">이 문서가 링크한 문서</p>
          <ul v-if="doc.linksOut.length > 0" class="source-list scrollable">
            <li v-for="link in doc.linksOut" :key="link.trackingCode">
              <button type="button" class="source-path" @click="openRelatedDocument(link.trackingCode)">
                {{ link.trackingCode }} · {{ link.title }}
              </button>
            </li>
          </ul>
          <p v-else class="muted">없음</p>
          <p class="related-doc-group-label">이 문서를 링크한 문서</p>
          <ul v-if="doc.backlinks.length > 0" class="source-list scrollable">
            <li v-for="link in doc.backlinks" :key="link.trackingCode">
              <button type="button" class="source-path" @click="openRelatedDocument(link.trackingCode)">
                {{ link.trackingCode }} · {{ link.title }}
              </button>
            </li>
          </ul>
          <p v-else class="muted">없음</p>
        </section>

        <section class="source-links">
          <h2>연관된 소스 코드</h2>
          <p v-if="sourceLinksError" class="error">{{ sourceLinksError }}</p>
          <ul v-if="sourceLinks.length > 0" class="source-list scrollable">
            <li v-for="link in sourceLinks" :key="link.id">
              <button type="button" class="source-path" @click="openSourceFile(link.filePath)">{{ link.filePath }}</button>
              <button v-if="doc.perm.write" type="button" class="remove-btn" @click="removeSourceLink(link.id)">해제</button>
            </li>
          </ul>
          <p v-else class="muted">연결된 소스코드가 없습니다.</p>
          <button v-if="doc.perm.write" type="button" class="secondary" @click="pickSourceLink">+ 소스 파일 연결</button>
        </section>
  
        <section class="source-links">
          <h2>연관 브랜치</h2>
          <p v-if="branchLinksError" class="error">{{ branchLinksError }}</p>
          <ul v-if="branchLinks.length > 0" class="source-list">
            <li v-for="link in branchLinks" :key="link.id">
              <span class="source-path">{{ link.branchName }}</span>
              <button v-if="doc.perm.write" type="button" class="remove-btn" @click="removeBranchLink(link.id)">해제</button>
            </li>
          </ul>
          <p v-else class="muted">연결된 브랜치가 없습니다.</p>
          <form v-if="doc.perm.write" class="branch-add-row" @submit.prevent="addBranchLink">
            <input v-model="newBranchName" type="text" placeholder="브랜치 이름" />
            <button type="submit" class="secondary" :disabled="!newBranchName.trim()">+ 브랜치 연결</button>
          </form>
        </section>
      </template>
      <template v-else-if="activeTab === 'chapters'">
        <p class="hint">
          본문을 마크다운 헤딩(#~######) 단위로 나눠 개별 조회·교체·삽입·삭제한다 - 긴 문서를 매번 전체로 안 읽고/안
          덮어써도 된다(CLI/MCP의 <code>docs chapter</code>/<code>chapter_*</code>와 같은 기능).
        </p>
        <p v-if="chaptersError" class="error">{{ chaptersError }}</p>
        <p v-if="chaptersLoading">불러오는 중...</p>
        <ul v-else class="chapter-list">
          <li v-for="c in chapters" :key="c.ordinal">
            <div class="chapter-row" :style="{ paddingLeft: `${Math.max(0, c.level - 1) * 16}px` }">
              <span class="chapter-ordinal">{{ c.ordinal }}</span>
              <span class="chapter-heading" :class="{ empty: !c.heading }">{{ chapterLabel(c) }}</span>
              <span class="chapter-lines">{{ c.lineStart }}-{{ c.lineEnd }}행</span>
              <span class="spacer"></span>
              <template v-if="doc.perm.write">
                <button type="button" class="secondary small" @click="startEditChapter(c.ordinal)">편집</button>
                <button type="button" class="danger small" @click="deleteChapter(c.ordinal)">삭제</button>
              </template>
            </div>
            <div v-if="editingChapterOrdinal === c.ordinal" class="chapter-edit-panel">
              <p v-if="editingChapterLoading">불러오는 중...</p>
              <template v-else>
                <MonacoEditor v-model="editingChapterContent" language="markdown" class="chapter-editor" />
                <p v-if="editingChapterError" class="error">{{ editingChapterError }}</p>
                <div class="edit-actions">
                  <button :disabled="editingChapterSaving" @click="saveEditChapter">
                    {{ editingChapterSaving ? "저장 중..." : "저장" }}
                  </button>
                  <button type="button" class="secondary" @click="cancelEditChapter">취소</button>
                </div>
              </template>
            </div>
          </li>
        </ul>
        <p v-if="!chaptersLoading && chapters.length === 0" class="muted">챕터가 없습니다.</p>

        <button v-if="doc.perm.write && !addingChapter" type="button" class="secondary" @click="startAddChapter">+ 챕터 추가</button>
        <div v-if="addingChapter" class="chapter-add-panel">
          <div class="chapter-add-position">
            <select v-model="addChapterPosition">
              <option value="atStart">문서 맨 앞에</option>
              <option value="atEnd">문서 맨 끝에</option>
              <option value="after">이 챕터 번호 다음에</option>
              <option value="before">이 챕터 번호 앞에</option>
            </select>
            <input
              v-if="addChapterPosition === 'after' || addChapterPosition === 'before'"
              v-model="addChapterRelativeOrdinal"
              type="number"
              step="1"
              min="0"
              placeholder="챕터 번호"
              class="chapter-ordinal-input"
            />
          </div>
          <MonacoEditor v-model="addChapterContent" language="markdown" class="chapter-editor" />
          <p class="hint">헤딩 줄 자체(`## 제목`처럼)를 포함해서 입력하세요.</p>
          <p v-if="addChapterError" class="error">{{ addChapterError }}</p>
          <div class="edit-actions">
            <button :disabled="addChapterSaving || !addChapterContent.trim()" @click="saveAddChapter">
              {{ addChapterSaving ? "추가 중..." : "추가" }}
            </button>
            <button type="button" class="secondary" @click="cancelAddChapter">취소</button>
          </div>
        </div>
      </template>
      <template v-else-if="activeTab === 'qa'">
        <QAPanel :project-id="id" target-type="document" :target-key="trackingCode" @status-transitioned="refreshStatus" />
      </template>
      <template v-else>
        <QAPanel :project-id="id" target-type="document" :target-key="trackingCode" history-only />
      </template>
    </div>
  </template>
</template>

<style scoped>
/* ProjectShellView.vue의 .tab-content가 flex:1;min-height:0인 flex
   컨테이너라(다른 탭 뷰의 헤더+내부 스크롤 목록 레이아웃을 위한 것) -
   이 뷰는 그 방식이 필요 없는 평범한 위→아래 문서 뷰인데, 감싸는
   div 없이 header/tabs/toolbar/body-view 등이 전부 .tab-content의
   직속 flex 자식이 되면서 기본 flex-shrink:1 때문에 문서 본문이 실제
   내용보다 짧게 눌리고(overflow:visible이라 클리핑도 스크롤도 안 되고
   그 아래 섹션들 위로 텍스트가 겹쳐 보임) - 이 래퍼 하나만 눌리지
   않게 하면 자연스러운 높이로 렌더링되고 상위 main.content의
   overflow-y:auto가 정상적으로 스크롤을 담당한다(실제 재현 확인). */
.document-editor {
  flex-shrink: 0;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}
.header code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
h1 {
  font-size: 19px;
  margin: 6px 0 0;
}
.meta {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.priority-badge {
  font-size: 12px;
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  padding: 4px 10px;
  border-radius: 999px;
}
.priority-input {
  width: 90px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.notice-banner {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
.notice-banner p {
  margin: 2px 0;
  font-size: 13px;
  color: var(--color-warning-text);
}
.tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  overflow-x: auto;
}
.tabs button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  flex-shrink: 0;
}
.tabs button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.star-btn {
  padding: 6px 10px !important;
  font-size: 16px !important;
  line-height: 1;
  color: var(--color-text-muted);
}
.star-btn.active {
  color: #e0a82e;
  border-color: #e0a82e !important;
  background: var(--color-warning-bg) !important;
}
.star-btn:disabled {
  opacity: 0.6;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
  flex-wrap: wrap;
}
.toolbar select {
  padding: 7px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  max-width: 320px;
  background: var(--color-surface);
  color: var(--color-text);
}
.spacer {
  flex: 1;
}
.guideline-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: -6px 0 12px;
}
.message-compose {
  background: var(--color-bg);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
}
.message-compose textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: inherit;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
}
.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
button.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  font-weight: 500;
}
button.danger {
  background: var(--color-surface);
  color: var(--color-danger);
  border: 1px solid var(--color-danger-border);
  font-weight: 500;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.body-view {
  margin: 16px 0;
  min-height: 200px;
}
.editor {
  height: 500px;
  margin: 16px 0;
}
.edit-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.source-links {
  margin-top: 28px;
}
.source-links h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.related-doc-group-label {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 6px;
}
.branch-add-row {
  display: flex;
  gap: 8px;
}
.branch-add-row input {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.source-list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.source-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light);
}
.source-list li:last-child {
  border-bottom: none;
}
.source-list.scrollable {
  max-height: 280px;
  overflow-x: hidden;
  overflow-y: auto;
}
.source-path {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 12px;
  text-align: left;
  font-family: monospace;
}
.remove-btn {
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 12px;
  flex-shrink: 0;
}
.remove-btn:hover {
  color: var(--color-danger);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
.saved {
  color: var(--color-success);
  font-size: 13px;
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 12px;
}
button.small {
  padding: 4px 10px;
  font-size: 12px;
}
.chapter-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.chapter-list > li {
  border-bottom: 1px solid var(--color-border-light);
}
.chapter-list > li:last-child {
  border-bottom: none;
}
.chapter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.chapter-ordinal {
  flex-shrink: 0;
  font-size: 11px;
  font-family: monospace;
  color: var(--color-text-faint);
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 20px;
  text-align: center;
}
.chapter-heading {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chapter-heading.empty {
  color: var(--color-text-faint);
  font-style: italic;
}
.chapter-lines {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-faint);
}
.chapter-edit-panel {
  padding: 0 12px 12px;
}
.chapter-editor {
  height: 300px;
  margin: 8px 0;
}
.chapter-add-panel {
  margin-top: 12px;
  padding: 12px;
  background: var(--color-bg);
  border-radius: 8px;
}
.chapter-add-position {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.chapter-add-position select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.chapter-ordinal-input {
  width: 100px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
@media (max-width: 768px) {
  .editor {
    height: 60vh;
  }
  .chapter-editor {
    height: 50vh;
  }
}
</style>
