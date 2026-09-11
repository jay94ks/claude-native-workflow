<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import MarkdownBody from "../components/MarkdownBody.vue";
import UserRef from "../components/UserRef.vue";
import QAPanel from "../components/QAPanel.vue";
import CommentsPanel from "../components/CommentsPanel.vue";
import { useEntityPickerStore } from "../stores/entityPicker";

const props = defineProps<{ id: string; trackingCode: string }>();
const router = useRouter();
const entityPicker = useEntityPickerStore();

interface DocumentDetail {
  trackingCode: string;
  title: string;
  body: string;
  statusCode: string;
  createdBy: string;
  notices?: string[];
}
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
    doc.value = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}`, {
      method: "PUT",
      body: JSON.stringify({ body: body.value }),
    });
    saveMessage.value = "저장됨";
    mode.value = "read";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function transition() {
  if (!toStatusCode.value) return;
  transitionError.value = "";
  try {
    doc.value = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatusCode: toStatusCode.value }),
    });
    toStatusCode.value = "";
    await loadNextStatuses();
  } catch (err) {
    transitionError.value = err instanceof ApiError ? err.message : "상태 전이에 실패했습니다";
  }
}

async function remove() {
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

const statusOptionLabel = computed(() => (s: NextStatus) => (s.guideline ? `${s.label} — ${s.guideline}` : s.label));

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
        <span class="status">{{ doc.statusCode }}</span>
      </div>
    </div>

    <div v-if="doc.notices && doc.notices.length > 0" class="notice-banner">
      <p v-for="(n, i) in doc.notices" :key="i">⚠ {{ n }}</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="saveMessage" class="saved">{{ saveMessage }}</p>
    <p v-if="messageSent" class="saved">메시지를 보냈습니다.</p>

    <div class="toolbar">
      <select v-model="toStatusCode">
        <option value="">상태 전이...</option>
        <option v-for="s in nextStatuses" :key="s.code" :value="s.code">{{ statusOptionLabel(s) }}</option>
      </select>
      <button class="secondary" :disabled="!toStatusCode" @click="transition">전이</button>
      <span v-if="transitionError" class="error">{{ transitionError }}</span>

      <span class="spacer"></span>

      <button v-if="mode === 'read'" class="secondary" @click="messageOpen = !messageOpen">메시지로 지시</button>
      <button v-if="mode === 'read'" class="secondary" @click="startEdit">편집</button>
      <button v-if="mode === 'read'" class="danger" :disabled="deleting" @click="remove">
        {{ deleting ? "삭제 중..." : "삭제" }}
      </button>
    </div>
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
          <button type="button" class="remove-btn" @click="removeSourceLink(link.id)">해제</button>
        </li>
      </ul>
      <p v-else class="muted">연결된 소스코드가 없습니다.</p>
      <button type="button" class="secondary" @click="pickSourceLink">+ 소스 파일 연결</button>
    </section>

    <QAPanel :project-id="id" target-type="document" :target-key="trackingCode" class="qa" @status-transitioned="refreshStatus" />
    <CommentsPanel :project-id="id" target-type="document" :target-key="trackingCode" />
  </template>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}
.header code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
h1 {
  font-size: 19px;
  margin: 6px 0 0;
}
.meta {
  font-size: 12px;
  color: #888;
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
  color: #555;
  background: #eef0f6;
  padding: 4px 10px;
  border-radius: 999px;
}
.notice-banner {
  background: #fbf3d9;
  border: 1px solid #ecd98a;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
.notice-banner p {
  margin: 2px 0;
  font-size: 13px;
  color: #7a5c00;
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
  border: 1px solid #d8dae0;
  border-radius: 6px;
  max-width: 320px;
}
.spacer {
  flex: 1;
}
.message-compose {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
}
.message-compose textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-family: inherit;
  resize: vertical;
}
.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
button.secondary {
  background: #fff;
  color: #333;
  border: 1px solid #d8dae0;
  font-weight: 500;
}
button.danger {
  background: #fff;
  color: #d1344b;
  border: 1px solid #f0c7d0;
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
.qa {
  margin-top: 28px;
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
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.source-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #eee;
}
.source-list li:last-child {
  border-bottom: none;
}
.source-path {
  background: none;
  border: none;
  color: #3454d1;
  font-size: 12px;
  text-align: left;
  font-family: monospace;
}
.remove-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 12px;
  flex-shrink: 0;
}
.remove-btn:hover {
  color: #d1344b;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
.saved {
  color: #1f9254;
  font-size: 13px;
}
</style>
