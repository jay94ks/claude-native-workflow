<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import RelationGraphCanvas from "../components/RelationGraphCanvas.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";
import type { RelationGraphEdge, RelationGraphNode } from "../utils/relationGraph";

const props = defineProps<{ id: string }>();
const route = useRoute();

interface CodeRelationDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  target: string;
  referrer: string;
  purpose: string;
  filePath: string;
  line: number | null;
  column: number | null;
  data: unknown;
  trackingCodes: string[];
  tags: string[];
  parentIds: string[];
  childIds: string[];
}

// relationCache가 유일한 진실 - nodes/edges는 여기서 파생된다. reactive()
// 라 새 id를 대입해도(cache[d.id] = d) 반응형으로 잡힌다(Vue 3 - Map과
// 달리 일반 객체는 새 속성 추가도 추적됨).
const relationCache = reactive<Record<string, CodeRelationDetail>>({});
const loading = ref(true);
const error = ref("");

const q = ref("");
const tag = ref("");
const fileFilter = ref("");
const trackingCodeFilter = ref("");
const depth = ref(3);
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

const selectedId = ref<string | null>(null);
const selected = computed(() => (selectedId.value ? relationCache[selectedId.value] : null));

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function matchesActiveFilter(d: CodeRelationDetail): boolean {
  const query = q.value.trim();
  if (query && [d.target, d.referrer, d.purpose].some((s) => s.includes(query))) return true;
  if (tag.value.trim() && d.tags.includes(tag.value.trim())) return true;
  if (trackingCodeFilter.value.trim() && d.trackingCodes.includes(trackingCodeFilter.value.trim())) return true;
  return false;
}

const nodes = computed<RelationGraphNode[]>(() => {
  const ids = new Set(Object.keys(relationCache));
  return Object.values(relationCache).map((d) => ({
    id: d.id,
    label: truncate(d.target, 40),
    hasUnexpandedChildren: d.childIds.some((cid) => !ids.has(cid)),
    tagged: matchesActiveFilter(d),
  }));
});

const edges = computed<RelationGraphEdge[]>(() => {
  const ids = new Set(Object.keys(relationCache));
  const list: RelationGraphEdge[] = [];
  for (const d of Object.values(relationCache)) {
    for (const parentId of d.parentIds) {
      if (ids.has(parentId)) list.push({ id: `${d.id}->${parentId}`, from: d.id, to: parentId });
    }
  }
  return list;
});

function clearCache() {
  for (const key of Object.keys(relationCache)) delete relationCache[key];
}
function mergeIntoCache(items: CodeRelationDetail[]) {
  for (const item of items) relationCache[item.id] = item;
}

async function search() {
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set("q", q.value.trim());
    if (tag.value.trim()) qs.set("tag", tag.value.trim());
    if (fileFilter.value.trim()) qs.set("filePath", fileFilter.value.trim());
    if (trackingCodeFilter.value.trim()) qs.set("trackingCode", trackingCodeFilter.value.trim());
    if (!q.value.trim() && !tag.value.trim() && !fileFilter.value.trim() && !trackingCodeFilter.value.trim()) {
      qs.set("hasNoParent", "true");
    }
    const items = await apiCall<CodeRelationDetail[]>(`/projects/${props.id}/relations?${qs}`);
    clearCache();
    mergeIntoCache(items);
    selectedId.value = null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "관계를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(search, 300);
}

async function selectNode(id: string) {
  selectedId.value = id;
  try {
    const detail = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${id}`);
    relationCache[id] = detail;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "관계를 불러오지 못했습니다";
  }
}

async function expandNode(id: string, direction: "parents" | "children") {
  try {
    const path = direction === "children" ? "descendants" : "ancestors";
    const items = await apiCall<CodeRelationDetail[]>(`/projects/${props.id}/relations/${id}/${path}?depth=1`);
    mergeIntoCache(items);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "펼치기에 실패했습니다";
  }
}

async function expandDeep(direction: "parents" | "children") {
  if (!selectedId.value) return;
  try {
    const path = direction === "children" ? "descendants" : "ancestors";
    const items = await apiCall<CodeRelationDetail[]>(
      `/projects/${props.id}/relations/${selectedId.value}/${path}?depth=${depth.value}`,
    );
    mergeIntoCache(items);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "펼치기에 실패했습니다";
  }
}

// ---------------------------------------------------------------- 생성/수정 폼
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formTarget = ref("");
const formReferrer = ref("");
const formPurpose = ref("");
const formFile = ref("");
const formLine = ref("");
const formColumn = ref("");
const formTags = ref("");
const formTrackingCodes = ref("");
const formData = ref("");
const formSaving = ref(false);
const formError = ref("");

function openCreateForm() {
  editingId.value = null;
  formTarget.value = "";
  formReferrer.value = "";
  formPurpose.value = "";
  formFile.value = fileFilter.value;
  formLine.value = "";
  formColumn.value = "";
  formTags.value = tag.value;
  formTrackingCodes.value = trackingCodeFilter.value;
  formData.value = "";
  formError.value = "";
  showForm.value = true;
}

function openEditForm(d: CodeRelationDetail) {
  editingId.value = d.id;
  formTarget.value = d.target;
  formReferrer.value = d.referrer;
  formPurpose.value = d.purpose;
  formFile.value = d.filePath;
  formLine.value = d.line !== null ? String(d.line) : "";
  formColumn.value = d.column !== null ? String(d.column) : "";
  formTags.value = d.tags.join(",");
  formTrackingCodes.value = d.trackingCodes.join(",");
  formData.value = d.data !== null && d.data !== undefined ? JSON.stringify(d.data, null, 2) : "";
  formError.value = "";
  showForm.value = true;
}

async function submitForm() {
  formSaving.value = true;
  formError.value = "";
  try {
    let parsedData: unknown;
    if (formData.value.trim()) {
      try {
        parsedData = JSON.parse(formData.value);
      } catch {
        throw new Error("추가 데이터는 올바른 JSON이어야 합니다");
      }
    }
    const body = {
      target: formTarget.value.trim(),
      referrer: formReferrer.value.trim(),
      purpose: formPurpose.value.trim(),
      filePath: formFile.value.trim(),
      line: formLine.value.trim() ? Number(formLine.value) : undefined,
      column: formColumn.value.trim() ? Number(formColumn.value) : undefined,
      data: parsedData,
      tags: formTags.value.trim() ? formTags.value.split(",").map((t) => t.trim()).filter(Boolean) : [],
      trackingCodes: formTrackingCodes.value.trim()
        ? formTrackingCodes.value.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
    };
    const saved = editingId.value
      ? await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${editingId.value}`, {
          method: "PUT",
          body: JSON.stringify(body),
        })
      : await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations`, { method: "POST", body: JSON.stringify(body) });
    relationCache[saved.id] = saved;
    selectedId.value = saved.id;
    showForm.value = false;
  } catch (err) {
    formError.value = err instanceof ApiError || err instanceof Error ? err.message : "저장에 실패했습니다";
  } finally {
    formSaving.value = false;
  }
}

async function removeSelected() {
  if (!selectedId.value) return;
  if (!window.confirm("이 관계를 삭제할까요? 연결된 상위/하위 링크만 함께 정리되고 나머지 그래프는 그대로 남습니다.")) return;
  try {
    await apiCall(`/projects/${props.id}/relations/${selectedId.value}`, { method: "DELETE" });
    delete relationCache[selectedId.value];
    selectedId.value = null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  }
}

// ---------------------------------------------------------------- 기존 노드와 연결
const linkParentInput = ref("");
const linkChildInput = ref("");
const linkError = ref("");

async function linkAsParent() {
  if (!selectedId.value || !linkParentInput.value.trim()) return;
  linkError.value = "";
  try {
    const updated = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${selectedId.value}`, {
      method: "PUT",
      body: JSON.stringify({ addParentIds: [linkParentInput.value.trim()] }),
    });
    relationCache[updated.id] = updated;
    const parent = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${linkParentInput.value.trim()}`).catch(() => null);
    if (parent) relationCache[parent.id] = parent;
    linkParentInput.value = "";
  } catch (err) {
    linkError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
  }
}

async function linkAsChild() {
  if (!selectedId.value || !linkChildInput.value.trim()) return;
  linkError.value = "";
  try {
    const updated = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${selectedId.value}`, {
      method: "PUT",
      body: JSON.stringify({ addChildIds: [linkChildInput.value.trim()] }),
    });
    relationCache[updated.id] = updated;
    const child = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${linkChildInput.value.trim()}`).catch(() => null);
    if (child) relationCache[child.id] = child;
    linkChildInput.value = "";
  } catch (err) {
    linkError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
  }
}

onMounted(() => {
  const initialQ = route.query.q as string | undefined;
  const initialFile = route.query.file as string | undefined;
  const initialTrackingCode = route.query.trackingCode as string | undefined;
  if (initialQ) q.value = initialQ;
  if (initialFile) fileFilter.value = initialFile;
  if (initialTrackingCode) trackingCodeFilter.value = initialTrackingCode;
  search();
});
</script>

<template>
  <section class="panel">
    <div class="toolbar">
      <input v-model="q" type="text" class="search-input" placeholder="검색(대상/참조 주체/목적)..." @input="onSearchInput" />
      <input v-model="tag" type="text" class="tag-input" placeholder="태그" @input="onSearchInput" />
      <input v-model="fileFilter" type="text" class="file-input" placeholder="파일 경로(정확 일치)" @input="onSearchInput" />
      <input v-model="trackingCodeFilter" type="text" class="file-input" placeholder="추적코드(정확 일치)" @input="onSearchInput" />
      <label class="depth-label">depth <input v-model.number="depth" type="number" min="1" max="20" class="depth-input" /></label>
      <button type="button" class="primary" @click="openCreateForm">새 관계 추가</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>

    <div class="layout">
      <RelationGraphCanvas
        class="canvas"
        :nodes="nodes"
        :edges="edges"
        :selected-id="selectedId"
        @select="selectNode"
        @expand="expandNode"
      />
      <aside class="sidebar">
        <template v-if="selected">
          <h3><TrackingCodeText :text="selected.target" /></h3>
          <dl>
            <dt>참조 주체</dt>
            <dd><TrackingCodeText :text="selected.referrer" /></dd>
            <dt>목적</dt>
            <dd><TrackingCodeText :text="selected.purpose" /></dd>
            <dt>파일</dt>
            <dd><code>{{ selected.filePath }}{{ selected.line ? `:${selected.line}` : "" }}{{ selected.column ? `:${selected.column}` : "" }}</code></dd>
            <dt>연관 문서</dt>
            <dd>
              <TrackingCodeText v-if="selected.trackingCodes.length" :text="selected.trackingCodes.join(', ')" />
              <span v-else class="muted">없음</span>
            </dd>
            <dt>태그</dt>
            <dd>
              <span v-for="t in selected.tags" :key="t" class="tag-chip">{{ t }}</span>
              <span v-if="selected.tags.length === 0" class="muted">없음</span>
            </dd>
            <dt>추가 데이터</dt>
            <dd><pre v-if="selected.data !== null && selected.data !== undefined" class="data-json">{{ JSON.stringify(selected.data, null, 2) }}</pre><span v-else class="muted">없음</span></dd>
            <dt>상위 관계</dt>
            <dd>{{ selected.parentIds.length }}개</dd>
            <dt>하위 관계</dt>
            <dd>{{ selected.childIds.length }}개</dd>
          </dl>

          <div class="button-row">
            <button type="button" @click="openEditForm(selected)">수정</button>
            <button type="button" class="danger" @click="removeSelected">삭제</button>
          </div>

          <div class="expand-row">
            <button type="button" @click="expandDeep('parents')">상위 펼치기 depth={{ depth }}</button>
            <button type="button" @click="expandDeep('children')">하위 펼치기 depth={{ depth }}</button>
          </div>

          <div class="link-section">
            <p class="hint">이미 있는 다른 관계와 연결(id로 지정)</p>
            <div class="link-row">
              <input v-model="linkParentInput" type="text" placeholder="상위로 연결할 관계 id" />
              <button type="button" @click="linkAsParent">연결</button>
            </div>
            <div class="link-row">
              <input v-model="linkChildInput" type="text" placeholder="하위로 연결할 관계 id" />
              <button type="button" @click="linkAsChild">연결</button>
            </div>
            <p v-if="linkError" class="error">{{ linkError }}</p>
          </div>
        </template>
        <p v-else class="muted">그래프에서 노드를 클릭하면 상세 정보가 여기 표시됩니다. 더블클릭하면 하위 관계가 한 단계 펼쳐집니다.</p>
      </aside>
    </div>

    <div v-if="showForm" class="overlay" @click.self="showForm = false">
      <div class="form-dialog">
        <button type="button" class="close-btn" @click="showForm = false">닫기 ✕</button>
        <h2>{{ editingId ? "관계 수정" : "새 관계 추가" }}</h2>
        <form @submit.prevent="submitForm">
          <label>대상(target)<input v-model="formTarget" type="text" required /></label>
          <label>참조 주체(referrer)<input v-model="formReferrer" type="text" required /></label>
          <label>목적(purpose)<textarea v-model="formPurpose" rows="3" required></textarea></label>
          <label>파일 경로(filePath)<input v-model="formFile" type="text" required /></label>
          <div class="form-row">
            <label>줄(line)<input v-model="formLine" type="number" /></label>
            <label>열(column)<input v-model="formColumn" type="number" /></label>
          </div>
          <label>태그(쉼표로 구분)<input v-model="formTags" type="text" /></label>
          <label>연관 문서 추적코드(쉼표로 구분, 여러 개 가능)<input v-model="formTrackingCodes" type="text" placeholder="DC-XXXXXXXX, SP-XXXXXXXX" /></label>
          <label>추가 데이터(JSON, 선택)<textarea v-model="formData" rows="4" placeholder="{}"></textarea></label>
          <p v-if="formError" class="error">{{ formError }}</p>
          <button type="submit" :disabled="formSaving">{{ formSaving ? "저장 중..." : "저장" }}</button>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.search-input,
.tag-input,
.file-input {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
}
.search-input {
  flex: 1;
  min-width: 180px;
}
.tag-input,
.file-input {
  width: 160px;
}
.depth-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.depth-input {
  width: 50px;
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
button.primary {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.layout {
  display: flex;
  gap: 16px;
  height: calc(100vh - 200px);
}
.canvas {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--color-border);
}
.sidebar {
  width: 320px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 14px;
  overflow-y: auto;
}
.sidebar h3 {
  font-size: 14px;
  margin: 0 0 10px;
  word-break: break-word;
}
.sidebar dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  margin: 0 0 12px;
}
.sidebar dt {
  color: var(--color-text-faint);
  font-size: 11px;
}
.sidebar dd {
  margin: 0;
  font-size: 12px;
  word-break: break-word;
}
.tag-chip {
  display: inline-block;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  margin: 0 4px 4px 0;
}
.data-json {
  background: var(--color-bg, var(--color-surface-hover));
  padding: 8px;
  border-radius: 6px;
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.button-row,
.expand-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.button-row button,
.expand-row button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.button-row button.danger {
  color: var(--color-danger);
  border-color: var(--color-danger);
}
.link-section {
  border-top: 1px solid var(--color-border-light);
  padding-top: 10px;
}
.link-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.link-row input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
}
.link-row button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.form-dialog {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 10px;
  padding: 24px;
  width: min(480px, 90vw);
  max-height: 85vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.form-dialog h2 {
  font-size: 16px;
  margin: 0 0 14px;
  padding-right: 80px;
}
.form-dialog form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-dialog label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.form-dialog input,
.form-dialog textarea {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  font-family: inherit;
}
.form-row {
  display: flex;
  gap: 10px;
}
.form-row label {
  flex: 1;
}
.form-dialog button[type="submit"] {
  align-self: flex-start;
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.form-dialog button:disabled {
  opacity: 0.6;
}
.hint {
  font-size: 11px;
  color: var(--color-text-faint);
  margin: 0 0 6px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 12px;
}
.error {
  color: var(--color-danger);
  font-size: 12px;
}
</style>
