<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import RelationGraphCanvas from "../components/RelationGraphCanvas.vue";
import RelationDetailPanel from "../components/RelationDetailPanel.vue";
import { useEntityPickerStore } from "../stores/entityPicker";
import type { RelationGraphEdge, RelationGraphNode } from "../utils/relationGraph";
import { RELATION_VIEW_MODES, DEFAULT_VIEW_MODE_ID } from "../utils/relationViewModes";

const props = defineProps<{ id: string }>();
const route = useRoute();
const entityPicker = useEntityPickerStore();

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
  branchName: string | null;
  trackingCodes: string[];
  tags: string[];
  parentIds: string[];
  childIds: string[];
}

// "전체 보기" 토글이 page/pageSize를 넘기면 백엔드가 이 모양
// (Page<CodeRelationDetail>)으로 응답한다 - 평소 필터 검색의 순수
// 배열 응답과 구분해서 처리해야 한다.
interface RelationPage {
  items: CodeRelationDetail[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

// ---------------------------------------------------------------- 뷰 모드 + 전체 보기
const viewMode = ref(DEFAULT_VIEW_MODE_ID);

// 필터 없이 프로젝트의 모든 관계를 한 번에 보고 싶을 때 - 무제한 로드는
// 절대 하지 않고 항상 명시적 pageSize 상한을 걸어서 호출한다(백엔드
// listRelations는 page/pageSize를 생략하면 전체 배열을 무제한 반환하는
// 기존 동작이 있음 - 이 토글은 그 경로를 안 탄다).
const ALL_PAGE_SIZE = 500;
const showAll = ref(false);
const allTotal = ref(0);
const allTotalPages = ref(0);

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
    primaryTag: d.tags[0],
  }));
});

// 태그를 하나라도 공유하는 노드끼리도 점선으로 잇는다(설계자 지시,
// #relation-graph-tag-edges) - 부모/자식 관계와는 별개 축. 태그→노드ID
// 역색인으로 만들어 같은 태그를 가진 노드끼리만 짝짓는다(전부 쌍으로
// 비교하는 것보다 훨씬 적은 비교 - "전체 보기"로 최대 500개 노드가
// 로드돼도 감당 가능). 이미 부모/자식으로 직접 이어진 쌍은 중복
// 렌더링(화살표 있는 선 위에 화살표 없는 선이 겹침)을 피하려 건너뛴다.
const parentChildPairKeys = computed<Set<string>>(() => {
  const set = new Set<string>();
  for (const d of Object.values(relationCache)) {
    for (const parentId of d.parentIds) set.add(d.id < parentId ? `${d.id}|${parentId}` : `${parentId}|${d.id}`);
  }
  return set;
});

const tagEdges = computed<RelationGraphEdge[]>(() => {
  const byTag = new Map<string, string[]>();
  for (const d of Object.values(relationCache)) {
    for (const t of d.tags) {
      const list = byTag.get(t);
      if (list) list.push(d.id);
      else byTag.set(t, [d.id]);
    }
  }
  const seenPairs = new Set<string>();
  const result: RelationGraphEdge[] = [];
  for (const ids of byTag.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const pairKey = `${a}|${b}`;
        if (seenPairs.has(pairKey) || parentChildPairKeys.value.has(pairKey)) continue;
        seenPairs.add(pairKey);
        result.push({ id: `tag:${pairKey}`, from: a, to: b, kind: "sharedTag" });
      }
    }
  }
  return result;
});

const edges = computed<RelationGraphEdge[]>(() => {
  const ids = new Set(Object.keys(relationCache));
  const list: RelationGraphEdge[] = [];
  for (const d of Object.values(relationCache)) {
    for (const parentId of d.parentIds) {
      if (ids.has(parentId)) list.push({ id: `${d.id}->${parentId}`, from: d.id, to: parentId, kind: "parentChild" });
    }
  }
  list.push(...tagEdges.value);
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
  allTotal.value = 0;
  allTotalPages.value = 0;
  try {
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set("q", q.value.trim());
    if (tag.value.trim()) qs.set("tag", tag.value.trim());
    if (fileFilter.value.trim()) qs.set("filePath", fileFilter.value.trim());
    if (trackingCodeFilter.value.trim()) qs.set("trackingCode", trackingCodeFilter.value.trim());
    const hasFilter = q.value.trim() || tag.value.trim() || fileFilter.value.trim() || trackingCodeFilter.value.trim();
    if (showAll.value) {
      qs.set("page", "1");
      qs.set("pageSize", String(ALL_PAGE_SIZE));
      const page = await apiCall<RelationPage>(`/projects/${props.id}/relations?${qs}`);
      clearCache();
      mergeIntoCache(page.items);
      allTotal.value = page.total;
      allTotalPages.value = page.totalPages;
    } else {
      if (!hasFilter) qs.set("hasNoParent", "true");
      const items = await apiCall<CodeRelationDetail[]>(`/projects/${props.id}/relations?${qs}`);
      clearCache();
      mergeIntoCache(items);
    }
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

function toggleShowAll() {
  showAll.value = !showAll.value;
  search();
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
const formTrackingCodesList = computed(() =>
  formTrackingCodes.value.split(",").map((s) => s.trim()).filter(Boolean),
);
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

// ---------------------------------------------------------------- 관계도 초기화
// 지금 로드된 relationCache는 화면에 펼쳐진 일부(루트/펼친 노드)만 담고
// 있어 "이 프로젝트의 전체 브랜치 목록"을 뽑아내는 신뢰할 소스가 못
// 된다 - 다이얼로그를 열 때마다 별도로 전체 목록(allBranches=true, 페이지
// 파라미터 생략 = 전체 배열, 기존 관례)을 받아와 distinct branchName을
// 뽑는다.
const showResetDialog = ref(false);
const resetBranchChoice = ref("__all__");
const resetBranches = ref<string[]>([]);
const resetHasNoBranch = ref(false);
const resetLoading = ref(false);
const resetSaving = ref(false);
const resetError = ref("");

async function openResetDialog() {
  resetBranchChoice.value = "__all__";
  resetError.value = "";
  resetLoading.value = true;
  showResetDialog.value = true;
  try {
    const all = await apiCall<CodeRelationDetail[]>(`/projects/${props.id}/relations?allBranches=true`);
    const set = new Set<string>();
    let hasNoBranch = false;
    for (const d of all) {
      if (d.branchName) set.add(d.branchName);
      else hasNoBranch = true;
    }
    resetBranches.value = [...set].sort();
    resetHasNoBranch.value = hasNoBranch;
  } catch (err) {
    resetError.value = err instanceof ApiError ? err.message : "브랜치 목록을 불러오지 못했습니다";
  } finally {
    resetLoading.value = false;
  }
}

async function confirmReset() {
  resetSaving.value = true;
  resetError.value = "";
  try {
    const qs = new URLSearchParams();
    if (resetBranchChoice.value === "__all__") qs.set("allBranches", "true");
    else qs.set("branchName", resetBranchChoice.value); // "__none__" 또는 실제 브랜치명
    await apiCall(`/projects/${props.id}/relations/reset?${qs}`, { method: "DELETE" });
    showResetDialog.value = false;
    selectedId.value = null;
    await search();
  } catch (err) {
    resetError.value = err instanceof ApiError ? err.message : "초기화에 실패했습니다";
  } finally {
    resetSaving.value = false;
  }
}

// ---------------------------------------------------------------- 추적코드 선택기
async function pickFormTrackingCodes() {
  const current = formTrackingCodes.value.trim()
    ? formTrackingCodes.value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const result = await entityPicker.pick({
    kind: "document",
    projectId: props.id,
    multi: true,
    allowManualEntry: false,
    initialSelected: current,
  });
  if (result) formTrackingCodes.value = result.join(",");
}

function removeFormTrackingCode(code: string) {
  formTrackingCodes.value = formTrackingCodes.value
    .split(",")
    .map((s) => s.trim())
    .filter((c) => c && c !== code)
    .join(",");
}

// ---------------------------------------------------------------- 기존 노드와 연결
const linkError = ref("");

async function linkAsParent(id: string) {
  if (!selectedId.value) return;
  linkError.value = "";
  try {
    const updated = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${selectedId.value}`, {
      method: "PUT",
      body: JSON.stringify({ addParentIds: [id] }),
    });
    relationCache[updated.id] = updated;
    const parent = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${id}`).catch(() => null);
    if (parent) relationCache[parent.id] = parent;
  } catch (err) {
    linkError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
  }
}

async function linkAsChild(id: string) {
  if (!selectedId.value) return;
  linkError.value = "";
  try {
    const updated = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${selectedId.value}`, {
      method: "PUT",
      body: JSON.stringify({ addChildIds: [id] }),
    });
    relationCache[updated.id] = updated;
    const child = await apiCall<CodeRelationDetail>(`/projects/${props.id}/relations/${id}`).catch(() => null);
    if (child) relationCache[child.id] = child;
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
      <button type="button" class="toggle" :class="{ active: showAll }" @click="toggleShowAll">전체 보기</button>
      <button type="button" class="primary" @click="openCreateForm">새 관계 추가</button>
      <button type="button" class="danger-outline" @click="openResetDialog">관계도 초기화</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <p v-if="showAll && allTotalPages > 1" class="muted">
      표시 한도 {{ ALL_PAGE_SIZE }}건을 초과해 일부만 표시됩니다(전체 {{ allTotal }}건).
    </p>

    <nav class="subtabs">
      <button
        v-for="mode in RELATION_VIEW_MODES"
        :key="mode.id"
        type="button"
        :class="{ active: viewMode === mode.id }"
        @click="viewMode = mode.id"
      >
        {{ mode.label }}
      </button>
    </nav>

    <div class="layout">
      <RelationGraphCanvas
        class="canvas"
        :nodes="nodes"
        :edges="edges"
        :selected-id="selectedId"
        :view-mode="viewMode"
        @select="selectNode"
        @expand="expandNode"
      />
      <RelationDetailPanel
        :detail="selected"
        :depth="depth"
        :link-error="linkError"
        @edit="openEditForm"
        @delete="removeSelected"
        @expand-parents="expandDeep('parents')"
        @expand-children="expandDeep('children')"
        @link-as-parent="linkAsParent"
        @link-as-child="linkAsChild"
      />
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
          <label>
            연관 문서 추적코드
            <div class="chip-row">
              <span v-for="code in formTrackingCodesList" :key="code" class="tag-chip removable">
                {{ code }} <button type="button" @click="removeFormTrackingCode(code)">✕</button>
              </span>
              <button type="button" class="secondary" @click="pickFormTrackingCodes">추적코드 선택</button>
            </div>
          </label>
          <label>추가 데이터(JSON, 선택)<textarea v-model="formData" rows="4" placeholder="{}"></textarea></label>
          <p v-if="formError" class="error">{{ formError }}</p>
          <button type="submit" :disabled="formSaving">{{ formSaving ? "저장 중..." : "저장" }}</button>
        </form>
      </div>
    </div>

    <div v-if="showResetDialog" class="overlay" @click.self="showResetDialog = false">
      <div class="form-dialog">
        <button type="button" class="close-btn" @click="showResetDialog = false">닫기 ✕</button>
        <h2>관계도 초기화</h2>
        <p class="hint">선택한 범위의 내 관계가 모두 삭제됩니다 - 되돌릴 수 없습니다.</p>
        <p v-if="resetLoading" class="muted">브랜치 목록을 불러오는 중...</p>
        <template v-else>
          <label>
            대상 브랜치
            <select v-model="resetBranchChoice">
              <option value="__all__">모든 브랜치</option>
              <option value="__none__">브랜치 없음</option>
              <option v-for="b in resetBranches" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <p v-if="resetError" class="error">{{ resetError }}</p>
          <div class="button-row">
            <button type="button" @click="showResetDialog = false">취소</button>
            <button type="button" class="danger" :disabled="resetSaving" @click="confirmReset">
              {{ resetSaving ? "삭제 중..." : "삭제" }}
            </button>
          </div>
        </template>
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
button.danger-outline {
  background: var(--color-surface);
  color: var(--color-danger);
  border: 1px solid var(--color-danger);
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
button.toggle {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
button.toggle.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.subtabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.subtabs button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
}
.subtabs button:hover {
  background: var(--color-surface-hover);
}
.subtabs button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
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
.tag-chip {
  display: inline-block;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  margin: 0 4px 4px 0;
}
.button-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.button-row button {
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
.form-dialog textarea,
.form-dialog select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  font-family: inherit;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.tag-chip.removable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tag-chip.removable button {
  background: none;
  border: none;
  color: inherit;
  font-size: 10px;
  padding: 0;
  line-height: 1;
}
.form-dialog button.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  align-self: flex-start;
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
