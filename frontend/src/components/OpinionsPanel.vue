<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import UserRef from "./UserRef.vue";
import TrackingCodeText from "./TrackingCodeText.vue";

// 코멘트(CommentsPanel.vue)와 정반대 채널 - 코멘트는 설계자들끼리만
// 공유되고 AI(CLI/MCP)에 노출되지 않는데, 의견은 AI가 참고해야 하는
// 채널이라 CLI/MCP(docs opinion *)로 직접 조회·확인 완료 처리할 수
// 있다. 그래서 이 패널은 수정/삭제가 없고(불변 - CodeReviewFinding과
// 같은 이유) 대신 상태 배지 + "확인 완료로 표시" 버튼이 있다.

// targetType은 TargetPanelDialog.vue의 공유 스토어(targetPanelDialog.ts
// 의 TargetPanelType)와 타입을 맞추기 위해 전체 합집합을 받는다 - 이
// 패널 자신은 실제로 document/plan만 다룬다(source/kanbanCard로는
// 호출부가 이 패널을 열지 않음).
const props = defineProps<{ projectId: string; targetType: "document" | "source" | "kanbanCard" | "plan"; targetKey: string }>();

interface OpinionItem {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  status: string; // open | resolved
  resolvedBy: string | null;
  resolvedAt: string | null;
}

const opinions = ref<OpinionItem[]>([]);
const loading = ref(true);
const error = ref("");
const newOpinion = ref("");
const adding = ref(false);
const resolvingId = ref("");

let disconnect: (() => void) | null = null;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ projectId: props.projectId, targetKey: props.targetKey, status: "all" });
    opinions.value = await apiCall<OpinionItem[]>(`/opinions?${qs}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "의견을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function add() {
  if (!newOpinion.value.trim()) return;
  adding.value = true;
  error.value = "";
  try {
    await apiCall("/opinions", { method: "POST", body: JSON.stringify({ trackingCode: props.targetKey, body: newOpinion.value.trim() }) });
    newOpinion.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "의견 등록에 실패했습니다";
  } finally {
    adding.value = false;
  }
}

async function resolve(o: OpinionItem) {
  resolvingId.value = o.id;
  error.value = "";
  try {
    await apiCall(`/opinions/${o.id}/resolve`, { method: "POST" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "확인 완료 처리에 실패했습니다";
  } finally {
    resolvingId.value = "";
  }
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.projectId, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "opinion" && event.targetType === props.targetType && event.targetKey === props.targetKey) load();
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section class="panel">
    <h2>의견</h2>
    <p class="hint">AI가 CLI/MCP(docs opinion *)로 직접 조회·확인 완료 처리하는 채널 - 코멘트와 별개.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="opinions">
      <li v-for="o in opinions" :key="o.id">
        <div class="o-row">
          <span class="author"><UserRef :user-id="o.authorId" /></span>
          <span class="body"><TrackingCodeText :text="o.body" /></span>
          <span class="at">{{ new Date(o.createdAt).toLocaleString() }}</span>
        </div>
        <div class="o-actions">
          <span class="status-badge" :class="o.status">{{ o.status === "open" ? "미확인" : "확인 완료" }}</span>
          <button v-if="o.status === 'open'" type="button" :disabled="resolvingId === o.id" @click="resolve(o)">확인 완료로 표시</button>
        </div>
      </li>
      <li v-if="opinions.length === 0" class="muted">아직 의견이 없습니다.</li>
    </ul>
    <form class="add-row" @submit.prevent="add">
      <textarea v-model="newOpinion" rows="2" placeholder="의견 입력... (AI가 참고합니다)"></textarea>
      <button type="submit" :disabled="adding">등록</button>
    </form>
  </section>
</template>

<style scoped>
.panel {
  margin-bottom: 28px;
}
h2 {
  font-size: 15px;
  margin: 0 0 4px;
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 10px;
}
.opinions {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.opinions li {
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border-light);
}
.opinions li:last-child {
  border-bottom: none;
}
.o-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
  flex-wrap: wrap;
}
.author {
  font-weight: 600;
  flex-shrink: 0;
}
.body {
  flex: 1;
  min-width: 120px;
}
.at {
  color: var(--color-text-faint);
  font-size: 11px;
  flex-shrink: 0;
}
.o-actions {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.o-actions button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.o-actions button:hover {
  background: var(--color-surface-hover);
}
.o-actions button:disabled {
  opacity: 0.6;
}
.status-badge {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}
.status-badge.open {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}
.status-badge.resolved {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.add-row {
  display: flex;
  gap: 8px;
}
.add-row textarea {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
}
.add-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  align-self: flex-start;
}
.add-row button:disabled {
  opacity: 0.6;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
