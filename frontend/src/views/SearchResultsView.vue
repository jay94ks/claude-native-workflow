<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ id: string }>();
const route = useRoute();
const router = useRouter();

interface DocumentHit {
  trackingCode: string;
  projectId: string;
  projectName: string;
  title: string;
  statusCode: string;
  snippet: string;
}
interface SourceFileHit {
  projectId: string;
  projectName: string;
  path: string;
  snippet: string;
}
interface SearchMultiResult {
  documents: DocumentHit[];
  sourceFiles: SourceFileHit[];
}

const documents = ref<DocumentHit[]>([]);
const sourceFiles = ref<SourceFileHit[]>([]);
const loading = ref(true);
const error = ref("");

const query = computed(() => (route.query.q as string | undefined) ?? "");
const scope = computed(() => (route.query.scope as string | undefined) ?? "project");
const includeSource = computed(() => route.query.includeSource === "true");

const SCOPE_LABEL: Record<string, string> = {
  project: "프로젝트 내에서",
  group: "프로젝트 그룹 내에서",
  team: "팀 내에서",
};

// 백엔드가 <mark> 대신 제어 문자 한 쌍(\x01/\x02)으로 매치 구간을 표시해
// 돌려준다(소스 코드 스니펫이 리터럴 HTML/JS 텍스트일 수 있어 v-html로
// 렌더링하면 XSS가 되기 때문) - 이 두 문자로 쪼개 각 조각을 텍스트
// 노드로만 렌더링하고, 구분자 사이 조각만 <mark>로 감싼다.
const HL_START = "\x01";
const HL_END = "\x02";

interface SnippetPart {
  text: string;
  highlight: boolean;
}

function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    const start = snippet.indexOf(HL_START, cursor);
    if (start < 0) {
      parts.push({ text: snippet.slice(cursor), highlight: false });
      break;
    }
    if (start > cursor) parts.push({ text: snippet.slice(cursor, start), highlight: false });
    const end = snippet.indexOf(HL_END, start + 1);
    if (end < 0) {
      parts.push({ text: snippet.slice(start + 1), highlight: false });
      break;
    }
    parts.push({ text: snippet.slice(start + 1, end), highlight: true });
    cursor = end + 1;
  }
  return parts;
}

async function load() {
  if (!query.value) {
    documents.value = [];
    sourceFiles.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams({ q: query.value, scope: scope.value, includeSource: String(includeSource.value) });
    const result = await apiCall<SearchMultiResult>(`/projects/${props.id}/search/multi?${qs}`);
    documents.value = result.documents;
    sourceFiles.value = result.sourceFiles;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "검색에 실패했습니다";
  } finally {
    loading.value = false;
  }
}

function openSourceFile(hit: SourceFileHit) {
  router.push(`/projects/${hit.projectId}/source?path=${encodeURIComponent(hit.path)}`);
}

onMounted(load);
watch([query, scope, includeSource], load);
</script>

<template>
  <h1>검색 결과</h1>
  <p class="meta">"{{ query }}" · {{ SCOPE_LABEL[scope] ?? scope }} 검색{{ includeSource ? " · 소스코드 포함" : "" }}</p>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading" class="muted">불러오는 중...</p>
  <template v-else>
    <section>
      <h2>문서 ({{ documents.length }})</h2>
      <ul v-if="documents.length > 0" class="list">
        <li v-for="d in documents" :key="d.trackingCode">
          <router-link :to="`/projects/${d.projectId}/documents/${d.trackingCode}`">
            <span class="project-badge">{{ d.projectName }}</span>
            <code>{{ d.trackingCode }}</code> {{ d.title }}
            <span class="status">{{ d.statusCode }}</span>
          </router-link>
          <p class="snippet">
            <template v-for="(part, i) in splitSnippet(d.snippet)" :key="i">
              <mark v-if="part.highlight">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
        </li>
      </ul>
      <p v-else class="muted">일치하는 문서가 없습니다.</p>
    </section>

    <section v-if="includeSource">
      <h2>소스 코드 ({{ sourceFiles.length }})</h2>
      <ul v-if="sourceFiles.length > 0" class="list">
        <li v-for="(s, i) in sourceFiles" :key="i" class="clickable" @click="openSourceFile(s)">
          <span>
            <span class="project-badge">{{ s.projectName }}</span>
            <code class="path">{{ s.path }}</code>
          </span>
          <p class="snippet">
            <template v-for="(part, j) in splitSnippet(s.snippet)" :key="j">
              <mark v-if="part.highlight">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
        </li>
      </ul>
      <p v-else class="muted">일치하는 소스 코드가 없습니다.</p>
    </section>
  </template>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 6px;
}
.meta {
  font-size: 12px;
  color: #888;
  margin: 0 0 20px;
}
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}
.list li:last-child {
  border-bottom: none;
}
.list li.clickable {
  cursor: pointer;
}
.list li.clickable:hover {
  background: #f7f8fb;
}
.list a {
  color: #1a1a2e;
  text-decoration: none;
  font-size: 13px;
}
.list a:hover {
  text-decoration: underline;
}
.project-badge {
  font-size: 11px;
  color: #555;
  background: #eef0f6;
  padding: 2px 8px;
  border-radius: 999px;
  margin-right: 6px;
}
.list code {
  font-size: 12px;
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 4px;
}
.path {
  font-family: monospace;
}
.status {
  font-size: 11px;
  color: #888;
  margin-left: 6px;
}
.snippet {
  margin: 6px 0 0;
  font-size: 12px;
  color: #555;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.snippet mark {
  background: #fdf0a8;
  color: inherit;
  border-radius: 2px;
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
