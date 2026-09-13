<script setup lang="ts">
// "문서" 탭 "폴더" 서브탭의 좌측 패널(#documents-tab-redesign) - 맨
// 위에 "전체 문서"(선택 해제)와 "미분류 문서"(가상 폴더) 두 고정
// 항목, 그 아래 실제 폴더 트리(FolderSelectNode.vue, 생성/이름변경/
// 삭제/드래그 재배치는 그대로). 문서 자체는 이 트리 어디에도 안
// 나온다 - 우측 DocumentListPanel이 선택된 항목에 맞는 목록을 따로
// 불러온다.
import { onMounted, ref } from "vue";
import draggable from "vuedraggable";
import { apiCall, ApiError } from "../api/client";
import { buildFolderTree, UNFILED_SENTINEL, type SelectableFolder, type SelectableFolderNode } from "../utils/folderTree";
import FolderSelectNode from "./FolderSelectNode.vue";

const props = defineProps<{ projectId: string; selectedFolderId: string | null }>();
const emit = defineEmits<{ select: [folderId: string | null] }>();

const rootFolders = ref<SelectableFolderNode[]>([]);
const loading = ref(true);
const error = ref("");

const showRootForm = ref(false);
const newRootName = ref("");

function collectExpanded(nodes: SelectableFolderNode[], map: Map<string, boolean>) {
  for (const n of nodes) {
    map.set(n.id, n.expanded);
    collectExpanded(n.children as SelectableFolderNode[], map);
  }
}

async function load(preserve = true) {
  loading.value = true;
  error.value = "";
  const prevExpanded = new Map<string, boolean>();
  if (preserve) collectExpanded(rootFolders.value, prevExpanded);
  try {
    const flat = await apiCall<Omit<SelectableFolder, "expanded">[]>(`/projects/${props.projectId}/folders`);
    const augmented: SelectableFolder[] = flat.map((f) => ({ ...f, expanded: prevExpanded.get(f.id) ?? false }));
    rootFolders.value = buildFolderTree(augmented) as SelectableFolderNode[];
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function onChanged(msg?: string) {
  if (msg) error.value = msg;
  load();
}

function openRootForm() {
  showRootForm.value = true;
  newRootName.value = "";
}
async function createRootFolder() {
  if (!newRootName.value.trim()) return;
  error.value = "";
  try {
    await apiCall(`/projects/${props.projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name: newRootName.value.trim() }),
    });
    showRootForm.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 생성에 실패했습니다";
  }
}

interface DraggableChangeEvent {
  added?: { element: SelectableFolderNode; newIndex: number };
  moved?: { newIndex: number };
}
async function onRootChanged(event: DraggableChangeEvent) {
  if (!event.added && !event.moved) return;
  const folderId = event.added?.element.id ?? rootFolders.value[event.moved!.newIndex].id;
  const siblingOrder = rootFolders.value.map((f) => f.id);
  try {
    await apiCall(`/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify({ parentFolderId: null, siblingOrder }),
    });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 이동에 실패했습니다";
    await load();
  }
}

onMounted(() => load(false));
defineExpose({ reload: () => load() });
</script>

<template>
  <div class="folder-select-tree">
    <div class="tree-toolbar">
      <span class="spacer"></span>
      <button class="new-root-btn" @click="openRootForm">+ 새 폴더</button>
    </div>
    <form v-if="showRootForm" class="new-form" @submit.prevent="createRootFolder">
      <input v-model="newRootName" type="text" placeholder="폴더 이름" />
      <button type="submit">생성</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>

    <ul class="fixed-items">
      <li class="fixed-item" :class="{ selected: selectedFolderId === null }" @click="emit('select', null)">📄 전체 문서</li>
      <li class="fixed-item" :class="{ selected: selectedFolderId === UNFILED_SENTINEL }" @click="emit('select', UNFILED_SENTINEL)">
        📂 미분류 문서
      </li>
    </ul>

    <p v-if="loading" class="muted">불러오는 중...</p>
    <draggable
      v-else
      v-model="rootFolders"
      item-key="id"
      tag="ul"
      class="root-children"
      group="folder-select-tree"
      handle=".folder-header"
      :animation="150"
      :force-fallback="true"
      ghost-class="drag-ghost"
      @change="onRootChanged"
    >
      <template #item="{ element }">
        <FolderSelectNode
          :node="element"
          :project-id="projectId"
          :selected-folder-id="selectedFolderId"
          @select="(id) => emit('select', id)"
          @changed="onChanged"
        />
      </template>
    </draggable>
    <p v-if="!loading && rootFolders.length === 0" class="muted">폴더가 없습니다.</p>
  </div>
</template>

<style scoped>
.folder-select-tree {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  user-select: none;
  min-width: 220px;
}
.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 0 8px;
}
.spacer {
  flex: 1;
}
.new-root-btn {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.new-form {
  display: flex;
  gap: 4px;
  padding: 4px 0 8px;
}
.new-form input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  user-select: text;
}
.new-form button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.fixed-items {
  list-style: none;
  padding: 0;
  margin: 0 0 6px;
  border-bottom: 1px solid var(--color-border-light);
  padding-bottom: 6px;
}
.fixed-item {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.fixed-item:hover {
  background: var(--color-surface-hover);
}
.fixed-item.selected {
  background: var(--color-primary);
  color: #fff;
}
.root-children {
  list-style: none;
  padding: 0;
  margin: 0;
}
.drag-ghost {
  opacity: 0.4;
  background: var(--color-surface-hover);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 4px 8px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
  padding: 4px 8px;
}
</style>
