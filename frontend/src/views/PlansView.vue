<script setup lang="ts">
import { inject, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";
import { useEntityPickerStore } from "../stores/entityPicker";
import Pagination from "../components/Pagination.vue";
import StatusBadge from "../components/StatusBadge.vue";

const props = defineProps<{ id: string }>();
const router = useRouter();
const entityPicker = useEntityPickerStore();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canCreate = roleSatisfies(myRole.value, "editor");

interface PlanStatus {
  code: string;
  label: string;
}
interface PlanSummary {
  trackingCode: string;
  title: string;
  status: string;
  updatedAt: string;
}
interface PlanPage {
  items: PlanSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const statuses = ref<PlanStatus[]>([]);
function statusLabel(code: string): string {
  return statuses.value.find((s) => s.code === code)?.label ?? code;
}

const filterStatus = ref("");
const filterQ = ref("");
const page = ref<PlanPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const pageNum = ref(1);
const loading = ref(true);
const error = ref("");

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
    // CLI/MCP는 이제 기본 정렬이 "의존도 낮은 순"(#plan-list-dependency-sort)
    // 이지만, 이 화면은 예전 그대로의 "최근 수정순"을 유지하려고 명시적으로
    // 넘긴다(안 넘기면 core의 새 기본값을 그대로 받아 화면 순서가 바뀜).
    const qs = new URLSearchParams({ page: String(pageNum.value), pageSize: "20", sort: "updatedAt:desc" });
    if (filterStatus.value) qs.set("status", filterStatus.value);
    if (filterQ.value.trim()) qs.set("q", filterQ.value.trim());
    page.value = await apiCall<PlanPage>(`/projects/${props.id}/plans?${qs}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "계획 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  pageNum.value = 1;
  load();
}
function onPageChange(p: number) {
  pageNum.value = p;
  load();
}

const newTitle = ref("");
const newRefs = ref<string[]>([]);
const newDependsOn = ref<string[]>([]);
const creating = ref(false);
const createError = ref("");

async function pickNewRefs() {
  const result = await entityPicker.pick({
    kind: "document",
    projectId: props.id,
    multi: true,
    allowManualEntry: false,
    initialSelected: newRefs.value,
  });
  if (result) newRefs.value = result;
}

async function pickNewDependsOn() {
  const result = await entityPicker.pick({
    kind: "plan",
    projectId: props.id,
    multi: true,
    allowManualEntry: false,
    initialSelected: newDependsOn.value,
  });
  if (result) newDependsOn.value = result;
}

async function create() {
  if (!newTitle.value.trim()) return;
  creating.value = true;
  createError.value = "";
  try {
    const plan = await apiCall<{ trackingCode: string }>(`/projects/${props.id}/plans`, {
      method: "POST",
      body: JSON.stringify({ title: newTitle.value.trim(), body: "", refs: newRefs.value, dependsOn: newDependsOn.value }),
    });
    router.push(`/projects/${props.id}/plans/${plan.trackingCode}`);
  } catch (err) {
    createError.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  } finally {
    creating.value = false;
  }
}

onMounted(async () => {
  await loadStatuses();
  await load();
});
</script>

<template>
  <div class="layout">
    <form v-if="canCreate" class="create-row" @submit.prevent="create">
      <input v-model="newTitle" type="text" placeholder="새 계획 제목" />
      <button type="button" class="secondary" @click="pickNewRefs">관련 문서 {{ newRefs.length > 0 ? `(${newRefs.length})` : "" }}</button>
      <button type="button" class="secondary" @click="pickNewDependsOn">선행 조건 {{ newDependsOn.length > 0 ? `(${newDependsOn.length})` : "" }}</button>
      <button type="submit" :disabled="creating">{{ creating ? "만드는 중..." : "만들기" }}</button>
    </form>
    <p v-if="createError" class="error">{{ createError }}</p>

    <div class="filter-row">
      <select v-model="filterStatus" @change="onFilterChange">
        <option value="">전체 상태</option>
        <option v-for="s in statuses" :key="s.code" :value="s.code">{{ s.label }}</option>
      </select>
      <input v-model="filterQ" type="text" placeholder="검색..." @keydown.enter="onFilterChange" />
      <button type="button" class="secondary" @click="onFilterChange">검색</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>
    <template v-else>
      <ul v-if="page.items.length > 0" class="list">
        <li v-for="p in page.items" :key="p.trackingCode" @click="router.push(`/projects/${id}/plans/${p.trackingCode}`)">
          <div class="row-main">
            <code>{{ p.trackingCode }}</code>
            <span class="title">{{ p.title }}</span>
          </div>
          <div class="row-meta">
            <StatusBadge :code="p.status" :label="statusLabel(p.status)" />
            <span class="muted">{{ new Date(p.updatedAt).toLocaleString() }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="muted">계획이 없습니다.</p>
      <Pagination :page="page.page" :total-pages="page.totalPages" @update:page="onPageChange" />
    </template>
  </div>
</template>

<style scoped>
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.create-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row button[type="submit"] {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.filter-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.filter-row select,
.filter-row input {
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.filter-row input {
  flex: 1;
}
.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  gap: 10px;
}
.list li:hover {
  background: var(--color-surface-hover);
}
.list li:last-child {
  border-bottom: none;
}
.row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.row-main code {
  font-size: 11px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
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
