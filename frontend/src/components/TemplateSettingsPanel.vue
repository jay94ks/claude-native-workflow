<script setup lang="ts">
import { inject, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import MonacoEditor from "./MonacoEditor.vue";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ projectId: string }>();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));

interface TemplateFile {
  filename: string;
  content: string;
  teamId: string | null;
  projectGroupId: string | null;
  projectId: string | null;
  updatedAt: string;
}

interface TemplateEntry {
  label: string;
  filename: string;
  loading: boolean;
  error: string;
  data: TemplateFile | null;
  expanded: boolean;
}

// SEED_FILES(backend/src/core/templates.ts)와 같은 2개 - 지금 이
// 시스템이 실제로 시드/배포하는 파일은 이 둘뿐이다.
const entries = ref<TemplateEntry[]>([
  { label: "CLAUDE.md", filename: "CLAUDE.md", loading: true, error: "", data: null, expanded: false },
  {
    label: "SKILL.md",
    filename: ".claude/skills/claude-native-workflow/SKILL.md",
    loading: true,
    error: "",
    data: null,
    expanded: false,
  },
]);

function scopeLabel(t: TemplateFile): string {
  if (t.projectId) return "이 프로젝트 override";
  if (t.projectGroupId) return "그룹 override";
  if (t.teamId) return "팀 override";
  return "설치 전역 기본값";
}

async function loadEntry(entry: TemplateEntry) {
  entry.loading = true;
  entry.error = "";
  try {
    const qs = new URLSearchParams({ filename: entry.filename, projectId: props.projectId });
    entry.data = await apiCall<TemplateFile>(`/templates?${qs}`);
  } catch (err) {
    entry.error = err instanceof ApiError ? err.message : "템플릿을 불러오지 못했습니다";
  } finally {
    entry.loading = false;
  }
}

async function load() {
  await Promise.all(entries.value.map(loadEntry));
}

const deploying = ref(false);
const deployResult = ref<string[] | null>(null);
const deployError = ref("");

async function deploy() {
  deploying.value = true;
  deployResult.value = null;
  deployError.value = "";
  try {
    const result = await apiCall<{ deployed: string[] }>(`/projects/${props.projectId}/templates/deploy`, { method: "POST" });
    deployResult.value = result.deployed;
  } catch (err) {
    deployError.value = err instanceof ApiError ? err.message : "배포에 실패했습니다";
  } finally {
    deploying.value = false;
  }
}

onMounted(load);
</script>

<template>
  <p class="hint">
    이 프로젝트에 적용될 CLAUDE.md/SKILL.md 내용 - 프로젝트 → 그룹 →
    팀 → 설치 전역 기본값 순으로 override를 찾아 해석한 최종 결과다
    (편집은 아직 CLI/MCP 전용 - `docs template set`).
  </p>
  <ul class="template-list">
    <li v-for="entry in entries" :key="entry.filename">
      <div class="row-header" @click="entry.expanded = !entry.expanded">
        <span class="filename">{{ entry.label }}</span>
        <template v-if="entry.data">
          <span class="scope-chip">{{ scopeLabel(entry.data) }}</span>
          <span class="muted">{{ new Date(entry.data.updatedAt).toLocaleString() }}</span>
        </template>
        <span class="spacer"></span>
        <span class="toggle">{{ entry.expanded ? "숨기기" : "내용 보기" }}</span>
      </div>
      <p v-if="entry.loading" class="muted">불러오는 중...</p>
      <p v-else-if="entry.error" class="error">{{ entry.error }}</p>
      <div v-else-if="entry.expanded && entry.data" class="viewer">
        <MonacoEditor :model-value="entry.data.content" language="markdown" read-only class="editor" />
      </div>
    </li>
  </ul>

  <div class="deploy-row">
    <button
      v-if="roleSatisfies(myRole, 'editor')"
      type="button"
      class="secondary"
      :disabled="deploying"
      @click="deploy"
    >
      {{ deploying ? "배포 중..." : "저장소에 배포" }}
    </button>
    <span v-if="deployResult" class="saved">{{ deployResult.length > 0 ? `${deployResult.join(", ")} 배포됨` : "배포할 override가 없습니다" }}</span>
    <span v-if="deployError" class="error">{{ deployError }}</span>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 12px;
}
.template-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.template-list > li {
  border-bottom: 1px solid var(--color-border-light);
}
.template-list > li:last-child {
  border-bottom: none;
}
.row-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
}
.row-header:hover {
  background: var(--color-surface-hover);
}
.filename {
  font-size: 13px;
  font-weight: 600;
  font-family: monospace;
}
.scope-chip {
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  padding: 3px 8px;
  border-radius: 999px;
}
.spacer {
  flex: 1;
}
.toggle {
  font-size: 12px;
  color: var(--color-primary);
}
.viewer {
  padding: 0 14px 14px;
}
.editor {
  height: 360px;
}
.deploy-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
}
.secondary:disabled {
  opacity: 0.6;
}
.muted {
  color: var(--color-text-muted);
  font-size: 12px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
.saved {
  color: var(--color-success);
  font-size: 13px;
}
</style>
