<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ endpoint: string }>();

interface CrossProjectOverrideRow {
  projectId: string;
  projectName: string;
  docTypeId: string | null;
  docTypeLabel: string | null;
  documentId: string | null;
  documentTrackingCode: string | null;
  documentTitle: string | null;
  canRead: boolean | null;
  canWrite: boolean | null;
  canDelete: boolean | null;
}

const rows = ref<CrossProjectOverrideRow[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    rows.value = await apiCall<CrossProjectOverrideRow[]>(props.endpoint);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "접근 제한 정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function scopeLabel(r: CrossProjectOverrideRow): string {
  if (r.documentId) return `문서(${r.documentTrackingCode ?? r.documentId}${r.documentTitle ? " · " + r.documentTitle : ""})`;
  if (r.docTypeId) return `타입(${r.docTypeLabel ?? r.docTypeId})`;
  return "공통";
}

function flagText(b: boolean | null): string {
  if (b === null) return "-";
  return b ? "허용" : "차단";
}

onMounted(load);
watch(() => props.endpoint, load);
</script>

<template>
  <div class="panel">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="overrides">
      <li v-for="(r, i) in rows" :key="i">
        <span class="project-name">{{ r.projectName }}</span>
        <span class="scope-label">{{ scopeLabel(r) }}</span>
        <span class="flags-view">읽기:{{ flagText(r.canRead) }} 쓰기:{{ flagText(r.canWrite) }} 삭제:{{ flagText(r.canDelete) }}</span>
      </li>
      <li v-if="rows.length === 0" class="muted">설정된 접근 제한이 없습니다.</li>
    </ul>
  </div>
</template>

<style scoped>
.panel {
  font-size: 12px;
}
.overrides {
  list-style: none;
  padding: 0;
  margin: 0;
}
.overrides li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #eee;
}
.overrides li:last-child {
  border-bottom: none;
}
.project-name {
  font-weight: 600;
  color: #333;
}
.scope-label {
  color: #666;
}
.flags-view {
  margin-left: auto;
  color: #888;
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
