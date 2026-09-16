<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import MarkdownBody from "../components/MarkdownBody.vue";
import UserRef from "../components/UserRef.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";
import QAPanel from "../components/QAPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useEntityPickerStore } from "../stores/entityPicker";
import { useToastStore } from "../stores/toast";
import { useTargetPanelDialogStore } from "../stores/targetPanelDialog";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string; trackingCode: string }>();
const router = useRouter();
const entityPicker = useEntityPickerStore();
const toast = useToastStore();
const targetPanelDialog = useTargetPanelDialogStore();
const activeTab = ref<"view" | "qa" | "qa-history">("view");

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canWrite = ref(false);
watch(myRole, (r) => (canWrite.value = roleSatisfies(r, "editor")), { immediate: true });

interface PlanStatus {
  code: string;
  label: string;
}
interface PlanDetail {
  trackingCode: string;
  projectId: string;
  title: string;
  body: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  refs: string[];
  dependencies: string[];
}

const statuses = ref<PlanStatus[]>([]);
const plan = ref<PlanDetail | null>(null);
const body = ref("");
const loading = ref(true);
const error = ref("");
const mode = ref<"read" | "edit">("read");
const saving = ref(false);
const saveMessage = ref("");

const titleInput = ref("");
const titleSaving = ref(false);
const titleError = ref("");

const statusSaving = ref(false);
const statusError = ref("");

const refsError = ref("");
const refsUpdating = ref(false);

const depsError = ref("");
const depsUpdating = ref(false);

const deleting = ref(false);
const deleteError = ref("");

const currentStatusLabel = computed(() => statuses.value.find((s) => s.code === plan.value?.status)?.label ?? plan.value?.status ?? "");

async function loadStatuses() {
  try {
    statuses.value = await apiCall<PlanStatus[]>(`/plans/statuses`);
  } catch {
    statuses.value = [];
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    plan.value = await apiCall<PlanDetail>(`/plans/${props.trackingCode}`);
    body.value = plan.value.body;
    titleInput.value = plan.value.title;
    mode.value = "read";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "계획을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function startEdit() {
  if (!plan.value) return;
  body.value = plan.value.body;
  saveMessage.value = "";
  mode.value = "edit";
}
function cancelEdit() {
  if (plan.value) body.value = plan.value.body;
  mode.value = "read";
}

async function saveBody() {
  saving.value = true;
  saveMessage.value = "";
  error.value = "";
  try {
    const updated = await apiCall<PlanDetail>(`/plans/${props.trackingCode}`, {
      method: "PUT",
      body: JSON.stringify({ body: body.value }),
    });
    plan.value = updated;
    saveMessage.value = "저장됨";
    mode.value = "read";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function saveTitle() {
  if (!titleInput.value.trim() || !plan.value || titleInput.value === plan.value.title) return;
  titleSaving.value = true;
  titleError.value = "";
  try {
    const updated = await apiCall<PlanDetail>(`/plans/${props.trackingCode}`, {
      method: "PUT",
      body: JSON.stringify({ title: titleInput.value.trim() }),
    });
    plan.value = updated;
  } catch (err) {
    titleError.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    titleSaving.value = false;
  }
}

async function changeStatus(status: string) {
  if (!plan.value || status === plan.value.status) return;
  statusSaving.value = true;
  statusError.value = "";
  try {
    plan.value = await apiCall<PlanDetail>(`/plans/${props.trackingCode}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    statusError.value = err instanceof ApiError ? err.message : "상태 변경에 실패했습니다";
  } finally {
    statusSaving.value = false;
  }
}

async function pickRefs() {
  if (!plan.value) return;
  const result = await entityPicker.pick({
    kind: "document",
    projectId: props.id,
    multi: true,
    allowManualEntry: false,
    initialSelected: plan.value.refs,
  });
  if (!result) return;
  const current = new Set(plan.value.refs);
  const next = new Set(result);
  const added = result.filter((c) => !current.has(c));
  const removed = plan.value.refs.filter((c) => !next.has(c));
  if (added.length === 0 && removed.length === 0) return;
  refsUpdating.value = true;
  refsError.value = "";
  try {
    for (const code of added) {
      await apiCall(`/plans/${props.trackingCode}/refs`, { method: "POST", body: JSON.stringify({ trackingCode: code }) });
    }
    for (const code of removed) {
      await apiCall(`/plans/${props.trackingCode}/refs/${code}`, { method: "DELETE" });
    }
    plan.value = await apiCall<PlanDetail>(`/plans/${props.trackingCode}`);
  } catch (err) {
    refsError.value = err instanceof ApiError ? err.message : "관련 문서 변경에 실패했습니다";
  } finally {
    refsUpdating.value = false;
  }
}

async function removeRef(code: string) {
  refsUpdating.value = true;
  refsError.value = "";
  try {
    plan.value = await apiCall<PlanDetail>(`/plans/${props.trackingCode}/refs/${code}`, { method: "DELETE" });
  } catch (err) {
    refsError.value = err instanceof ApiError ? err.message : "관련 문서 제거에 실패했습니다";
  } finally {
    refsUpdating.value = false;
  }
}

async function pickDependencies() {
  if (!plan.value) return;
  const result = await entityPicker.pick({
    kind: "plan",
    projectId: props.id,
    multi: true,
    allowManualEntry: false,
    initialSelected: plan.value.dependencies,
    excludeKeys: [plan.value.trackingCode],
  });
  if (!result) return;
  const current = new Set(plan.value.dependencies);
  const next = new Set(result);
  const added = result.filter((c) => !current.has(c));
  const removed = plan.value.dependencies.filter((c) => !next.has(c));
  if (added.length === 0 && removed.length === 0) return;
  depsUpdating.value = true;
  depsError.value = "";
  try {
    for (const code of added) {
      await apiCall(`/plans/${props.trackingCode}/dependencies`, { method: "POST", body: JSON.stringify({ trackingCode: code }) });
    }
    for (const code of removed) {
      await apiCall(`/plans/${props.trackingCode}/dependencies/${code}`, { method: "DELETE" });
    }
    plan.value = await apiCall<PlanDetail>(`/plans/${props.trackingCode}`);
  } catch (err) {
    depsError.value = err instanceof ApiError ? err.message : "선행 조건 변경에 실패했습니다";
  } finally {
    depsUpdating.value = false;
  }
}

async function removeDependency(code: string) {
  depsUpdating.value = true;
  depsError.value = "";
  try {
    plan.value = await apiCall<PlanDetail>(`/plans/${props.trackingCode}/dependencies/${code}`, { method: "DELETE" });
  } catch (err) {
    depsError.value = err instanceof ApiError ? err.message : "선행 조건 제거에 실패했습니다";
  } finally {
    depsUpdating.value = false;
  }
}

async function remove() {
  if (!plan.value) return;
  const confirmed = window.confirm(`"${plan.value.title}"(${props.trackingCode}) 계획을 삭제하시겠습니까?`);
  if (!confirmed) return;
  deleting.value = true;
  deleteError.value = "";
  try {
    await apiCall(`/plans/${props.trackingCode}`, { method: "DELETE" });
    router.push(`/projects/${props.id}/plans`);
  } catch (err) {
    deleteError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
    deleting.value = false;
  }
}

watch(
  () => props.trackingCode,
  () => {
    activeTab.value = "view";
    mode.value = "read";
    saveMessage.value = "";
    titleError.value = "";
    statusError.value = "";
    refsError.value = "";
    depsError.value = "";
    deleteError.value = "";
    load();
  },
);
onMounted(async () => {
  await loadStatuses();
  await load();
});

// 지금 읽고 있는 계획이 다른 세션에서 개정되거나 새 질의가 등록되면
// 토스트로 알려준다(#realtime-toast, DocumentEditorView.vue와 같은
// 패턴) - props.trackingCode를 핸들러 안에서 직접 참조해 다른
// 계획으로 이동해 컴포넌트가 재사용돼도 항상 정확히 걸러진다.
let disconnectRealtime: (() => void) | null = null;
onMounted(async () => {
  disconnectRealtime = await connectProjectRealtime(props.id, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "plan" && event.action === "update" && event.trackingCode === props.trackingCode) {
        toast.push("계획이 개정되었습니다.");
      } else if (
        event.entity === "question" &&
        event.action === "create" &&
        event.targetType === "plan" &&
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
  <p v-else-if="error && !plan" class="error">{{ error }}</p>
  <template v-else-if="plan">
    <div class="plan-editor">
      <div class="header">
        <div>
          <code>{{ plan.trackingCode }}</code>
          <div v-if="canWrite" class="title-edit">
            <input v-model="titleInput" type="text" @keydown.enter="saveTitle" @blur="saveTitle" />
          </div>
          <h1 v-else>{{ plan.title }}</h1>
          <div class="meta">작성자 <UserRef :user-id="plan.createdBy" /></div>
          <p v-if="titleError" class="error">{{ titleError }}</p>
        </div>
        <div class="actions">
          <select v-if="canWrite" :value="plan.status" :disabled="statusSaving" @change="changeStatus(($event.target as HTMLSelectElement).value)">
            <option v-for="s in statuses" :key="s.code" :value="s.code">{{ s.label }}</option>
          </select>
          <StatusBadge v-else :code="plan.status" :label="currentStatusLabel" />
        </div>
      </div>
      <p v-if="statusError" class="error">{{ statusError }}</p>

      <div class="tabs">
        <button :class="{ active: activeTab === 'view' }" @click="activeTab = 'view'">보기</button>
        <button :class="{ active: activeTab === 'qa' }" @click="activeTab = 'qa'">질의/답변</button>
        <button :class="{ active: activeTab === 'qa-history' }" @click="activeTab = 'qa-history'">답변 기록</button>
        <span class="spacer"></span>
        <button class="secondary" @click="targetPanelDialog.show('comments', id, 'plan', trackingCode)">코멘트</button>
        <button class="secondary" @click="targetPanelDialog.show('opinion', id, 'plan', trackingCode)">의견</button>
      </div>

      <template v-if="activeTab === 'view'">
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="saveMessage" class="saved">{{ saveMessage }}</p>

        <div v-if="canWrite" class="toolbar">
          <span class="spacer"></span>
          <button v-if="mode === 'read'" class="secondary" @click="startEdit">편집</button>
          <button class="danger" :disabled="deleting" @click="remove">{{ deleting ? "삭제 중..." : "삭제" }}</button>
        </div>
        <p v-if="deleteError" class="error">{{ deleteError }}</p>

        <template v-if="mode === 'read'">
          <MarkdownBody :body="plan.body" class="body-view" />
        </template>
        <template v-else>
          <MonacoEditor v-model="body" language="markdown" class="editor" />
          <div class="edit-actions">
            <button :disabled="saving" @click="saveBody">{{ saving ? "저장 중..." : "저장" }}</button>
            <button type="button" class="secondary" @click="cancelEdit">취소</button>
          </div>
        </template>

        <section class="refs-section">
          <h2>관련 문서</h2>
          <p v-if="refsError" class="error">{{ refsError }}</p>
          <ul v-if="plan.refs.length > 0" class="refs-list">
            <li v-for="code in plan.refs" :key="code">
              <TrackingCodeText :text="code" />
              <button v-if="canWrite" type="button" class="remove-btn" :disabled="refsUpdating" @click="removeRef(code)">해제</button>
            </li>
          </ul>
          <p v-else class="muted">관련 문서가 없습니다.</p>
          <button v-if="canWrite" type="button" class="secondary" :disabled="refsUpdating" @click="pickRefs">+ 관련 문서 선택</button>
        </section>

        <section class="refs-section">
          <h2>선행 조건</h2>
          <p class="hint">이 계획을 시작하기 전에 먼저 끝나야 하는 다른 계획들.</p>
          <p v-if="depsError" class="error">{{ depsError }}</p>
          <ul v-if="plan.dependencies.length > 0" class="refs-list">
            <li v-for="code in plan.dependencies" :key="code">
              <TrackingCodeText :text="code" />
              <button v-if="canWrite" type="button" class="remove-btn" :disabled="depsUpdating" @click="removeDependency(code)">해제</button>
            </li>
          </ul>
          <p v-else class="muted">선행 조건이 없습니다.</p>
          <button v-if="canWrite" type="button" class="secondary" :disabled="depsUpdating" @click="pickDependencies">+ 선행 조건 선택</button>
        </section>
      </template>
      <template v-else-if="activeTab === 'qa'">
        <QAPanel :project-id="plan.projectId" target-type="plan" :target-key="plan.trackingCode" />
      </template>
      <template v-else>
        <QAPanel :project-id="plan.projectId" target-type="plan" :target-key="plan.trackingCode" history-only />
      </template>
    </div>
  </template>
</template>

<style scoped>
.plan-editor {
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
.title-edit {
  margin-top: 6px;
}
.title-edit input {
  font-size: 17px;
  font-weight: 600;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  width: min(480px, 100%);
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
.actions select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
}
.tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 16px;
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
.spacer {
  flex: 1;
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
.refs-section {
  margin-top: 28px;
}
.refs-section h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.refs-list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.refs-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light);
}
.refs-list li:last-child {
  border-bottom: none;
}
.remove-btn {
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 12px;
  flex-shrink: 0;
  padding: 2px 6px;
}
.remove-btn:hover {
  color: var(--color-danger);
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 10px;
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
