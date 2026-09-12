<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useFolderPickerStore } from "../stores/folderPicker";
import { nextDialogZIndex } from "../dialogZIndex";
import { buildFolderTree, type FolderTreeNode } from "../utils/folderTree";
import FolderPickerNode from "./FolderPickerNode.vue";

interface FolderItem {
  id: string;
  parentFolderId: string | null;
  name: string;
}
type Node = FolderItem & FolderTreeNode<FolderItem>;

const store = useFolderPickerStore();
const folders = ref<FolderItem[]>([]);
const loading = ref(false);
const error = ref("");
const zIndex = ref(1100);
// undefined = 아직 아무것도 안 고름(이동 버튼 비활성), null = "폴더
// 없음"을 명시적으로 고름, string = 고른 폴더 id.
const selected = ref<string | null | undefined>(undefined);

const tree = computed<Node[]>(() => buildFolderTree(folders.value));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    folders.value = await apiCall<FolderItem[]>(`/projects/${store.projectId}/folders`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "폴더 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

watch(
  () => store.open,
  (open) => {
    if (!open) return;
    zIndex.value = nextDialogZIndex();
    selected.value = undefined;
    load();
  },
);

function select(id: string | null) {
  selected.value = id;
}

function confirm() {
  if (selected.value === undefined) return;
  store.confirm(selected.value);
}
</script>

<template>
  <div v-if="store.open" class="overlay" :style="{ zIndex }" @click.self="store.cancel()">
    <div class="dialog">
      <div class="header">
        <h2>폴더 선택</h2>
        <button class="close-btn" @click="store.cancel()">닫기 ✕</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <ul v-else class="list">
        <li class="node root" :class="{ active: selected === null }" @click="select(null)">
          <span>(폴더 없음)</span>
        </li>
        <FolderPickerNode
          v-for="node in tree"
          :key="node.id"
          :node="node"
          :selected="selected"
          @select="select"
        />
        <li v-if="tree.length === 0" class="muted empty">폴더가 없습니다.</li>
      </ul>
      <div class="actions">
        <button type="button" class="cancel" @click="store.cancel()">취소</button>
        <button type="button" class="confirm" :disabled="selected === undefined" @click="confirm()">이동</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.dialog {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 10px;
  padding: 20px;
  width: min(420px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.header h2 {
  font-size: 16px;
  margin: 0;
}
.close-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.list {
  list-style: none;
  padding: 4px;
  margin: 0 0 10px;
  overflow-y: auto;
  flex: 1;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
}
.node.root {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 4px;
}
.node.root:hover {
  background: var(--color-surface-hover);
}
.node.root.active {
  background: var(--color-tcode-hover-bg);
  color: var(--color-primary);
  font-weight: 600;
}
.empty {
  padding: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions .cancel {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 8px 16px;
  border-radius: 6px;
}
.actions .confirm {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.actions .confirm:disabled {
  background: var(--color-primary-muted);
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
