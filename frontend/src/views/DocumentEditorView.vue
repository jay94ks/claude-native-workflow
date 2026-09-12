<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import MarkdownBody from "../components/MarkdownBody.vue";
import UserRef from "../components/UserRef.vue";
import QAPanel from "../components/QAPanel.vue";
import { useEntityPickerStore } from "../stores/entityPicker";
import { useTargetPanelDialogStore } from "../stores/targetPanelDialog";
import { useFolderPickerStore } from "../stores/folderPicker";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string; trackingCode: string }>();
const router = useRouter();
const entityPicker = useEntityPickerStore();
const targetPanelDialog = useTargetPanelDialogStore();
const folderPicker = useFolderPickerStore();
const activeTab = ref<"view" | "qa">("view");

// 메시지로 지시는 문서 자체 권한이 아니라 프로젝트 editor 이상(백엔드
// POST .../messages가 requireProjectRole("editor")) - 편집/저장/삭제/
// 전이/소스연결은 doc.perm(문서별 세부 권한, resolveEffectivePermission
// 결과)을 그대로 쓴다.
const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canSendInstruction = computed(() => roleSatisfies(myRole.value, "editor"));

interface DocumentDetail {
  trackingCode: string;
  title: string;
  body: string;
  statusCode: string;
  priority: number | null;
  createdBy: string;
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

async function load() {
  loading.value = true;
  error.value = "";
  try {
    doc.value = await fetchDocument(true);
    body.value = doc.value.body;
    priorityInput.value = doc.value.priority === null ? "" : String(doc.value.priority);
    mode.value = "read";
    await Promise.all([loadNextStatuses(), loadSourceLinks()]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서를 불러오지 못했습니다";
  } finally {
    loading.value = false;
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
    load();
  },
);
onMounted(load);
</script>

<template>
  <p v-if="loading">불러오는 중...</p>
  <p v-else-if="error && !doc" class="error">{{ error }}</p>
  <template v-else-if="doc">
    <div class="header">
      <div>
        <code>{{ doc.trackingCode }}</code>
        <h1>{{ doc.title }}</h1>
        <div class="meta">작성자 <UserRef :user-id="doc.createdBy" /></div>
      </div>
      <div class="actions">
        <span v-if="doc.priority !== null" class="priority-badge">우선순위 {{ doc.priority }}</span>
        <span class="status">{{ doc.statusCode }}</span>
      </div>
    </div>

    <div v-if="doc.notices && doc.notices.length > 0" class="notice-banner">
      <p v-for="(n, i) in doc.notices" :key="i">⚠ {{ n }}</p>
    </div>

    <div class="tabs">
      <button :class="{ active: activeTab === 'view' }" @click="activeTab = 'view'">보기</button>
      <button :class="{ active: activeTab === 'qa' }" @click="activeTab = 'qa'">질의/답변</button>
      <span class="spacer"></span>
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
        <h2>연관된 소스 코드</h2>
        <p v-if="sourceLinksError" class="error">{{ sourceLinksError }}</p>
        <ul v-if="sourceLinks.length > 0" class="source-list">
          <li v-for="link in sourceLinks" :key="link.id">
            <button type="button" class="source-path" @click="openSourceFile(link.filePath)">{{ link.filePath }}</button>
            <button v-if="doc.perm.write" type="button" class="remove-btn" @click="removeSourceLink(link.id)">해제</button>
          </li>
        </ul>
        <p v-else class="muted">연결된 소스코드가 없습니다.</p>
        <button v-if="doc.perm.write" type="button" class="secondary" @click="pickSourceLink">+ 소스 파일 연결</button>
      </section>
    </template>
    <template v-else>
      <QAPanel :project-id="id" target-type="document" :target-key="trackingCode" @status-transitioned="refreshStatus" />
    </template>
  </template>
</template>

<style scoped>
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
.status {
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  padding: 4px 10px;
  border-radius: 999px;
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
@media (max-width: 768px) {
  .editor {
    height: 60vh;
  }
}
</style>
