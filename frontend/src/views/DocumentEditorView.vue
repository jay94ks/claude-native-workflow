<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import QAPanel from "../components/QAPanel.vue";
import CommentsPanel from "../components/CommentsPanel.vue";

const props = defineProps<{ id: string; trackingCode: string }>();

interface DocumentDetail {
  trackingCode: string;
  title: string;
  body: string;
  statusCode: string;
}

const doc = ref<DocumentDetail | null>(null);
const body = ref("");
const loading = ref(true);
const error = ref("");
const saving = ref(false);
const saveMessage = ref("");

const toStatusCode = ref("");
const transitionError = ref("");

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

async function load() {
  loading.value = true;
  error.value = "";
  try {
    doc.value = await fetchDocument(true);
    body.value = doc.value.body;
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
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function transition() {
  if (!toStatusCode.value.trim()) return;
  transitionError.value = "";
  try {
    doc.value = await apiCall<DocumentDetail>(`/documents/${props.trackingCode}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatusCode: toStatusCode.value.trim() }),
    });
    toStatusCode.value = "";
  } catch (err) {
    transitionError.value = err instanceof ApiError ? err.message : "상태 전이에 실패했습니다";
  }
}

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
      </div>
      <div class="actions">
        <span class="status">{{ doc.statusCode }}</span>
        <button :disabled="saving" @click="save">{{ saving ? "저장 중..." : "저장" }}</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="saveMessage" class="saved">{{ saveMessage }}</p>

    <MonacoEditor v-model="body" language="markdown" class="editor" />

    <div class="transition-row">
      <input v-model="toStatusCode" type="text" placeholder="전이할 상태 코드(예: active)" />
      <button @click="transition">상태 전이</button>
      <span v-if="transitionError" class="error">{{ transitionError }}</span>
    </div>

    <QAPanel :project-id="id" :tracking-code="trackingCode" class="qa" @status-transitioned="refreshStatus" />
    <CommentsPanel :project-id="id" :tracking-code="trackingCode" />
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
button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
button:disabled {
  opacity: 0.6;
}
.editor {
  height: 500px;
  margin: 16px 0;
}
.transition-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.transition-row input {
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.qa {
  margin-top: 28px;
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
