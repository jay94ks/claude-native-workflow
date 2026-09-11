<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useEntityPickerStore } from "../stores/entityPicker";

interface Item {
  key: string;
  label: string;
}

const store = useEntityPickerStore();

const items = ref<Item[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const selected = ref<Set<string>>(new Set());
const manualEntry = ref("");

interface DocumentSummary {
  trackingCode: string;
  title: string;
}
interface UserListItem {
  id: string;
  displayLabel: string;
}
interface FullTreeEntry {
  path: string;
}

async function load() {
  const options = store.options;
  if (!options) return;
  loading.value = true;
  error.value = "";
  try {
    if (options.kind === "document") {
      const docs = await apiCall<DocumentSummary[]>(`/projects/${options.projectId ?? ""}/documents`);
      items.value = docs.map((d) => ({ key: d.trackingCode, label: `${d.trackingCode} · ${d.title}` }));
    } else if (options.kind === "user") {
      const users = await apiCall<UserListItem[]>(`/users?limit=100`);
      items.value = users.map((u) => ({ key: u.id, label: u.displayLabel }));
    } else {
      const files = await apiCall<FullTreeEntry[]>(`/projects/${options.projectId ?? ""}/git/tree/all`);
      items.value = files.map((f) => ({ key: f.path, label: f.path }));
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

watch(
  () => store.open,
  (open) => {
    if (!open) return;
    search.value = "";
    manualEntry.value = "";
    selected.value = new Set(store.options?.initialSelected ?? []);
    load();
  },
);

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((i) => i.label.toLowerCase().includes(q));
});

function toggle(key: string) {
  const opts = store.options;
  if (!opts) return;
  if (opts.multi) {
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
  } else {
    selected.value = new Set([key]);
  }
}

function addManual() {
  const value = manualEntry.value.trim();
  if (!value) return;
  const opts = store.options;
  if (opts?.multi) {
    selected.value = new Set([...selected.value, value]);
  } else {
    selected.value = new Set([value]);
  }
  manualEntry.value = "";
}

function confirm() {
  store.confirm([...selected.value]);
}

const kindTitle = computed(() => {
  const k = store.options?.kind;
  if (store.options?.title) return store.options.title;
  if (k === "document") return "문서 선택";
  if (k === "user") return "사용자 선택";
  if (k === "sourceFile") return "소스 파일 선택";
  return "선택";
});
</script>

<template>
  <div v-if="store.open" class="overlay" @click.self="store.cancel()">
    <div class="dialog">
      <div class="header">
        <h2>{{ kindTitle }}</h2>
        <button class="close-btn" @click="store.cancel()">닫기 ✕</button>
      </div>
      <input v-model="search" type="text" class="search" placeholder="검색..." />
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="loading" class="muted">불러오는 중...</p>
      <ul v-else class="list">
        <li v-for="item in filteredItems" :key="item.key" @click="toggle(item.key)">
          <input
            :type="store.options?.multi ? 'checkbox' : 'radio'"
            :checked="selected.has(item.key)"
            @click.stop="toggle(item.key)"
          />
          <span>{{ item.label }}</span>
        </li>
        <li v-if="filteredItems.length === 0" class="muted empty">항목이 없습니다.</li>
      </ul>
      <div v-if="store.options?.allowManualEntry" class="manual-row">
        <input v-model="manualEntry" type="text" placeholder="목록에 없으면 직접 입력..." @keydown.enter.prevent="addManual" />
        <button type="button" @click="addManual">추가</button>
      </div>
      <div v-if="selected.size > 0" class="selected-chips">
        <span v-for="key in selected" :key="key" class="chip">{{ key }} <button type="button" @click="toggle(key)">×</button></span>
      </div>
      <div class="actions">
        <button type="button" class="cancel" @click="store.cancel()">취소</button>
        <button type="button" class="confirm" @click="confirm()">확인</button>
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
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: min(520px, 90vw);
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
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.search {
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  margin-bottom: 10px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  overflow-y: auto;
  flex: 1;
  border: 1px solid #eee;
  border-radius: 8px;
}
.list li {
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #f0f1f5;
  cursor: pointer;
  font-size: 13px;
}
.list li:last-child {
  border-bottom: none;
}
.list li:hover {
  background: #f7f8fb;
}
.list li.empty {
  cursor: default;
}
.list li.empty:hover {
  background: none;
}
.manual-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.manual-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.manual-row button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 12px;
  border-radius: 6px;
}
.selected-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.chip {
  background: #eef0f6;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.chip button {
  background: none;
  border: none;
  cursor: pointer;
  color: #888;
  font-size: 13px;
  line-height: 1;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions .cancel {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 16px;
  border-radius: 6px;
}
.actions .confirm {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
