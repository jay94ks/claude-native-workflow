<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { apiCall, apiCallBlob, ApiError } from "../api/client";
import MonacoEditor from "../components/MonacoEditor.vue";
import Pagination from "../components/Pagination.vue";
import { languageForPath } from "../utils/language";
import { classifyFileKind, type FileKind } from "../utils/fileKind";
import { useTargetPanelDialogStore } from "../stores/targetPanelDialog";

const props = defineProps<{ id: string }>();
const route = useRoute();
const targetPanelDialog = useTargetPanelDialogStore();
const ENTRIES_PAGE_SIZE = 30;
const entriesPage = ref(1);

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}
interface GitRepo {
  provider: string;
  repoUrl: string;
}

const hasRepo = ref<boolean | null>(null);
const currentDir = ref("");
const entries = ref<TreeEntry[]>([]);
const treeError = ref("");
const treeLoading = ref(true);

const selectedPath = ref("");
const fileKind = ref<FileKind>("text");
const fileContent = ref("");
const originalContent = ref("");
const editMode = ref(false);
const mediaObjectUrl = ref<string | null>(null);
const fileError = ref("");
const fileLoading = ref(false);
const saving = ref(false);
const saveMessage = ref("");
const downloading = ref(false);
const downloadError = ref("");

const newFilePath = ref("");

const hasChanges = computed(() => fileContent.value !== originalContent.value);

async function checkRepo() {
  try {
    await apiCall<GitRepo>(`/projects/${props.id}/git/repo`);
    hasRepo.value = true;
  } catch {
    hasRepo.value = false;
  }
}

async function loadTree(dirPath: string) {
  treeLoading.value = true;
  treeError.value = "";
  try {
    entries.value = await apiCall<TreeEntry[]>(`/projects/${props.id}/git/tree?path=${encodeURIComponent(dirPath)}`);
    currentDir.value = dirPath;
    entriesPage.value = 1;
  } catch (err) {
    treeError.value = err instanceof ApiError ? err.message : "디렉터리를 불러오지 못했습니다";
  } finally {
    treeLoading.value = false;
  }
}

const entriesTotalPages = computed(() => Math.max(1, Math.ceil(entries.value.length / ENTRIES_PAGE_SIZE)));
const pagedEntries = computed(() =>
  entries.value.slice((entriesPage.value - 1) * ENTRIES_PAGE_SIZE, entriesPage.value * ENTRIES_PAGE_SIZE),
);

function parentDir(dirPath: string): string {
  const parts = dirPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function revokeMediaUrl() {
  if (mediaObjectUrl.value) {
    URL.revokeObjectURL(mediaObjectUrl.value);
    mediaObjectUrl.value = null;
  }
}

async function openFile(path: string) {
  fileLoading.value = true;
  fileError.value = "";
  saveMessage.value = "";
  const kind = classifyFileKind(path);
  try {
    if (kind === "text") {
      const file = await apiCall<{ content: string }>(`/projects/${props.id}/git/file?path=${encodeURIComponent(path)}`);
      revokeMediaUrl();
      selectedPath.value = path;
      fileKind.value = "text";
      fileContent.value = file.content;
      originalContent.value = file.content;
      editMode.value = false;
    } else {
      const blob = await apiCallBlob(`/projects/${props.id}/git/file/raw?path=${encodeURIComponent(path)}`);
      revokeMediaUrl();
      selectedPath.value = path;
      fileKind.value = kind;
      mediaObjectUrl.value = URL.createObjectURL(blob);
    }
  } catch (err) {
    fileError.value = err instanceof ApiError ? err.message : "파일을 불러오지 못했습니다";
  } finally {
    fileLoading.value = false;
  }
}

async function openEntry(entry: TreeEntry) {
  if (entry.type === "dir") {
    await loadTree(entry.path);
    return;
  }
  await openFile(entry.path);
}

function openNewFile() {
  const path = newFilePath.value.trim();
  if (!path) return;
  revokeMediaUrl();
  selectedPath.value = path;
  fileKind.value = "text";
  fileContent.value = "";
  originalContent.value = "";
  editMode.value = true;
  fileError.value = "";
  saveMessage.value = "";
  newFilePath.value = "";
}

function startEdit() {
  editMode.value = true;
  saveMessage.value = "";
}

function cancelEdit() {
  fileContent.value = originalContent.value;
  editMode.value = false;
}

async function save() {
  if (!selectedPath.value) return;
  saving.value = true;
  saveMessage.value = "";
  fileError.value = "";
  try {
    await apiCall(`/projects/${props.id}/git/file?path=${encodeURIComponent(selectedPath.value)}`, {
      method: "PUT",
      body: JSON.stringify({ content: fileContent.value, message: `docs: update ${selectedPath.value}` }),
    });
    originalContent.value = fileContent.value;
    editMode.value = false;
    saveMessage.value = "커밋됨";
    if (currentDir.value === parentDir(selectedPath.value)) await loadTree(currentDir.value);
  } catch (err) {
    fileError.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function downloadOriginal() {
  if (!selectedPath.value) return;
  downloading.value = true;
  downloadError.value = "";
  try {
    const blob = await apiCallBlob(`/projects/${props.id}/git/file/raw?path=${encodeURIComponent(selectedPath.value)}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedPath.value.split("/").pop() || selectedPath.value;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    downloadError.value = err instanceof ApiError ? err.message : "다운로드에 실패했습니다";
  } finally {
    downloading.value = false;
  }
}

onMounted(async () => {
  await checkRepo();
  if (!hasRepo.value) return;
  const initialPath = route.query.path as string | undefined;
  if (initialPath) {
    await loadTree(parentDir(initialPath));
    await openFile(initialPath);
  } else {
    await loadTree("");
  }
});

onBeforeUnmount(() => revokeMediaUrl());
</script>

<template>
  <p v-if="hasRepo === false" class="muted">
    연결된 git 저장소가 없습니다 - 프로젝트 상세 화면에서 <code>docs git link</code>로 먼저 연결하세요.
  </p>
  <div v-else-if="hasRepo" class="layout">
    <aside class="tree">
      <div class="path-bar">
        <button v-if="currentDir" @click="loadTree(parentDir(currentDir))">.. (상위)</button>
        <span class="current-path">/{{ currentDir }}</span>
      </div>
      <p v-if="treeError" class="error">{{ treeError }}</p>
      <p v-if="treeLoading">불러오는 중...</p>
      <ul v-else class="entries">
        <li v-for="e in pagedEntries" :key="e.path" :class="{ dir: e.type === 'dir', active: e.path === selectedPath }" @click="openEntry(e)">
          {{ e.type === "dir" ? "📁" : "📄" }} {{ e.name }}
        </li>
      </ul>
      <Pagination v-if="!treeLoading" :page="entriesPage" :total-pages="entriesTotalPages" @update:page="entriesPage = $event" />
      <form class="new-file" @submit.prevent="openNewFile">
        <input v-model="newFilePath" type="text" placeholder="새 파일 경로(예: docs/note.md)" />
        <button type="submit">열기</button>
      </form>
    </aside>
    <section class="editor-pane">
      <template v-if="selectedPath">
        <div class="editor-header">
          <code>{{ selectedPath }}</code>
          <div class="header-actions">
            <button
              type="button"
              class="secondary"
              @click="targetPanelDialog.show('qa', id, 'source', selectedPath)"
            >
              질의/답변
            </button>
            <button
              type="button"
              class="secondary"
              @click="targetPanelDialog.show('comments', id, 'source', selectedPath)"
            >
              코멘트
            </button>
            <button type="button" class="secondary" :disabled="downloading" @click="downloadOriginal">
              {{ downloading ? "받는 중..." : "원본 다운로드" }}
            </button>
            <template v-if="fileKind === 'text'">
              <template v-if="!editMode">
                <button type="button" @click="startEdit">편집</button>
              </template>
              <template v-else>
                <button v-if="hasChanges" :disabled="saving" @click="save">{{ saving ? "저장 중..." : "저장" }}</button>
                <button type="button" class="secondary" @click="cancelEdit">편집 취소</button>
              </template>
            </template>
          </div>
        </div>
        <p v-if="fileError" class="error">{{ fileError }}</p>
        <p v-if="downloadError" class="error">{{ downloadError }}</p>
        <p v-if="saveMessage" class="saved">{{ saveMessage }}</p>
        <div class="content-area">
          <p v-if="fileLoading">불러오는 중...</p>
          <template v-else-if="fileKind === 'text'">
            <MonacoEditor v-model="fileContent" :language="languageForPath(selectedPath)" :read-only="!editMode" class="editor" />
          </template>
          <template v-else-if="fileKind === 'image'">
            <img v-if="mediaObjectUrl" :src="mediaObjectUrl" class="media-preview" :alt="selectedPath" />
          </template>
          <template v-else-if="fileKind === 'video'">
            <video v-if="mediaObjectUrl" :src="mediaObjectUrl" controls class="media-preview" />
          </template>
        </div>
      </template>
      <p v-else class="muted">왼쪽에서 파일을 선택하세요.</p>
    </section>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 16px;
  height: calc(100vh - 140px);
}
.tree {
  width: 260px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.path-bar button {
  font-size: 12px;
  background: #eef0f6;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
}
.current-path {
  font-size: 12px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entries {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
}
.entries li {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.entries li:hover {
  background: #f0f1f5;
}
.entries li.active {
  background: #e4e9fb;
}
.new-file {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.new-file input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 12px;
}
.new-file button {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #d8dae0;
  background: #fff;
}
.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.editor-header code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.header-actions button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.header-actions button.secondary {
  background: #fff;
  color: #333;
  border: 1px solid #d8dae0;
  font-weight: 500;
}
.header-actions button:disabled {
  opacity: 0.6;
}
.content-area {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.editor {
  height: 100%;
  min-height: 400px;
}
.media-preview {
  max-width: 100%;
  display: block;
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
