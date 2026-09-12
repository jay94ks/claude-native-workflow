<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { apiCall, apiCallText, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { diffLines } from "diff";
import { useNicknamesStore } from "../stores/nicknames";
import { useEntityPickerStore } from "../stores/entityPicker";
import { parseUnifiedDiff, type FileDiff } from "../utils/diffParse";
import DiffFileList from "../components/DiffFileList.vue";

const props = defineProps<{ id: string }>();
const nicknames = useNicknamesStore();
const entityPicker = useEntityPickerStore();

// ---------------------------------------------------------------- git 커밋 로그

interface GitRepo {
  provider: string;
  repoUrl: string;
}
interface Commit {
  sha: string;
  commit: { message: string; author: { date: string; name: string } };
}

interface CommitPage {
  items: Commit[];
  hasMore: boolean;
}

const COMMITS_PAGE_SIZE = 20;
const hasRepo = ref<boolean | null>(null);
const commits = ref<Commit[]>([]);
const commitsPage = ref(1);
const commitsHasMore = ref(false);
const commitsError = ref("");
const commitsLoading = ref(false);
const selectedSha = ref("");
const diffText = ref("");
const diffError = ref("");
const diffLoading = ref(false);

async function checkRepo() {
  try {
    await apiCall<GitRepo>(`/projects/${props.id}/git/repo`);
    hasRepo.value = true;
  } catch {
    hasRepo.value = false;
  }
}

async function loadCommits() {
  commitsLoading.value = true;
  commitsError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(commitsPage.value), pageSize: String(COMMITS_PAGE_SIZE) });
    const result = await apiCall<CommitPage>(`/projects/${props.id}/git/log/page?${qs}`);
    commits.value = result.items;
    commitsHasMore.value = result.hasMore;
  } catch (err) {
    commitsError.value = err instanceof ApiError ? err.message : "커밋 로그를 불러오지 못했습니다";
  } finally {
    commitsLoading.value = false;
  }
}

function goCommitsPage(page: number) {
  if (page < 1) return;
  commitsPage.value = page;
  loadCommits();
}

async function openCommit(sha: string) {
  selectedSha.value = sha;
  diffLoading.value = true;
  diffError.value = "";
  try {
    diffText.value = await apiCallText(`/projects/${props.id}/git/diff/${sha}`);
  } catch (err) {
    diffError.value = err instanceof ApiError ? err.message : "diff를 불러오지 못했습니다";
  } finally {
    diffLoading.value = false;
  }
}

const commitFiles = computed<FileDiff[]>(() => parseUnifiedDiff(diffText.value));

// ---------------------------------------------------------------- 문서 버전 이력

interface DocumentDetail {
  trackingCode: string;
  title: string;
  body: string;
}
interface Revision {
  id: string;
  body: string;
  editedBy: string;
  editedAt: string;
}
interface TimelineEntry {
  id: string;
  label: string;
  body: string;
}

const selectedDoc = ref("");
// 선택한 문서의 표시 라벨(추적코드+제목) - 별도 조회 없이 loadRevisions()
// 가 이미 받아오는 DocumentDetail.title을 그대로 재사용한다.
const selectedDocTitle = ref("");
const timeline = ref<TimelineEntry[]>([]);
const fromId = ref("");
const toId = ref("");
const revisionsError = ref("");
const revisionsLoading = ref(false);

// 문서가 많은 프로젝트에서 전체 목록을 한 번에 안 받도록(#large-list-
// pagination), 여러 화면이 이미 공유하는 검색 기반 선택기(EntityPickerDialog)
// 를 그대로 재사용한다 - QAPanel.vue의 "근거 추가"와 같은 패턴.
async function pickDocument() {
  const result = await entityPicker.pick({ kind: "document", projectId: props.id, multi: false, allowManualEntry: false });
  if (result && result[0]) selectedDoc.value = result[0];
}

function clearSelectedDoc() {
  selectedDoc.value = "";
}

async function loadRevisions() {
  if (!selectedDoc.value) {
    timeline.value = [];
    selectedDocTitle.value = "";
    return;
  }
  revisionsLoading.value = true;
  revisionsError.value = "";
  try {
    const [revisions, doc] = await Promise.all([
      apiCall<Revision[]>(`/documents/${selectedDoc.value}/revisions`),
      apiCall<DocumentDetail>(`/documents/${selectedDoc.value}`),
    ]);
    selectedDocTitle.value = doc.title;
    await Promise.all(revisions.map((r) => nicknames.ensure(r.editedBy)));
    const entries: TimelineEntry[] = revisions.map((r) => ({
      id: r.id,
      label: `${new Date(r.editedAt).toLocaleString()} (${nicknames.labels[r.editedBy] ?? r.editedBy})`,
      body: r.body,
    }));
    entries.push({ id: "current", label: "현재", body: doc.body });
    timeline.value = entries;
    if (entries.length >= 2) {
      fromId.value = entries[entries.length - 2].id;
      toId.value = entries[entries.length - 1].id;
    } else {
      fromId.value = "";
      toId.value = "";
    }
  } catch (err) {
    revisionsError.value = err instanceof ApiError ? err.message : "버전 이력을 불러오지 못했습니다";
  } finally {
    revisionsLoading.value = false;
  }
}

// diffLines()가 이미 만들어주는 {value,added,removed} 조각들을 한
// "파일"짜리 FileDiff로 감싸 DiffFileList와 같은 카드 스타일(접기/
// 펼치기, +N/-M 배지)을 그대로 재사용한다 - diff 알고리즘을 새로
// 만들지 않고 재포장만 함.
const revisionFiles = computed<FileDiff[]>(() => {
  const from = timeline.value.find((t) => t.id === fromId.value);
  const to = timeline.value.find((t) => t.id === toId.value);
  if (!from || !to) return [];
  const parts = diffLines(from.body, to.body);
  const lines: FileDiff["hunks"][number]["lines"] = [];
  let additions = 0;
  let deletions = 0;
  for (const part of parts) {
    const kind = part.added ? "add" : part.removed ? "del" : "ctx";
    const partLines = part.value.split("\n");
    if (partLines[partLines.length - 1] === "") partLines.pop();
    for (const text of partLines) {
      lines.push({ kind, text });
      if (kind === "add") additions++;
      else if (kind === "del") deletions++;
    }
  }
  return [{ oldPath: from.label, newPath: to.label, binary: false, additions, deletions, hunks: [{ header: "", lines }] }];
});

watch(selectedDoc, loadRevisions);

// ---------------------------------------------------------------- 실시간 갱신

let disconnect: (() => void) | null = null;

onMounted(async () => {
  await checkRepo();
  if (hasRepo.value) await loadCommits();

  disconnect = await connectProjectRealtime(props.id, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "project" && hasRepo.value) {
        commitsPage.value = 1;
        loadCommits();
      }
      if (event.entity === "document" && event.trackingCode === selectedDoc.value) {
        // "현재" 항목은 DB가 아니라 검색 색인을 거쳐 조회된다(GET
        // /documents/:trackingCode → Meilisearch) - 리비전 목록(DB 직접
        // 조회)은 이 이벤트 시점에 이미 최신이지만, 색인은 write-through
        // upsert가 비동기라 살짝 지연될 수 있다(DocumentEditorView의 404
        // 재시도와 같은 원인 - 거기선 즉시 재조회가 404로 실패해서
        // 재시도했지만, 여기선 200과 함께 "이전" 본문이 조용히 와서
        // 실패 신호 자체가 없다). 이벤트 직후 바로 재조회하면 diff의
        // "현재" 쪽이 방금 반영된 수정 내용을 놓칠 수 있어, 색인이
        // 따라잡을 시간을 준 뒤 재조회한다.
        setTimeout(loadRevisions, 500);
      }
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section>
    <h2>git 커밋 로그</h2>
    <p v-if="hasRepo === false" class="muted">
      연결된 git 저장소가 없습니다 - 프로젝트 상세 화면에서 <code>docs git link</code>로 먼저 연결하세요.
    </p>
    <div v-else-if="hasRepo" class="git-layout">
      <aside class="commit-list">
        <p v-if="commitsError" class="error">{{ commitsError }}</p>
        <p v-if="commitsLoading">불러오는 중...</p>
        <ul v-else class="entries">
          <li
            v-for="c in commits"
            :key="c.sha"
            :class="{ active: c.sha === selectedSha }"
            @click="openCommit(c.sha)"
          >
            <code>{{ c.sha.slice(0, 8) }}</code>
            <span>{{ c.commit.message.split("\n")[0] }}</span>
          </li>
          <li v-if="commits.length === 0" class="muted">커밋이 없습니다.</li>
        </ul>
        <div v-if="!commitsLoading" class="commit-pagination">
          <button type="button" :disabled="commitsPage <= 1" @click="goCommitsPage(commitsPage - 1)">이전</button>
          <span class="status">{{ commitsPage }}</span>
          <button type="button" :disabled="!commitsHasMore" @click="goCommitsPage(commitsPage + 1)">다음</button>
        </div>
      </aside>
      <div class="diff-pane">
        <p v-if="diffError" class="error">{{ diffError }}</p>
        <p v-if="diffLoading">불러오는 중...</p>
        <DiffFileList v-else-if="selectedSha" :files="commitFiles" />
        <p v-else class="muted">왼쪽에서 커밋을 선택하세요.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>문서 버전 이력</h2>
    <p v-if="revisionsError" class="error">{{ revisionsError }}</p>
    <div class="filter-row">
      <button type="button" @click="pickDocument">{{ selectedDoc ? "문서 바꾸기..." : "문서 선택..." }}</button>
      <span v-if="selectedDoc" class="selected-doc-label">{{ selectedDoc }} · {{ selectedDocTitle }}</span>
      <button v-if="selectedDoc" type="button" class="clear-btn" @click="clearSelectedDoc">선택 해제</button>
    </div>
    <p v-if="revisionsLoading">불러오는 중...</p>
    <template v-else-if="selectedDoc">
      <p v-if="timeline.length < 2" class="muted">비교할 리비전이 부족합니다(수정 이력이 1건 이하).</p>
      <template v-else>
        <div class="filter-row">
          <select v-model="fromId">
            <option v-for="t in timeline" :key="t.id" :value="t.id">{{ t.label }}</option>
          </select>
          <span>→</span>
          <select v-model="toId">
            <option v-for="t in timeline" :key="t.id" :value="t.id">{{ t.label }}</option>
          </select>
        </div>
        <DiffFileList :files="revisionFiles" />
      </template>
    </template>
  </section>
</template>

<style scoped>
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
}
.git-layout {
  display: flex;
  gap: 16px;
  height: 420px;
}
.commit-list {
  width: 280px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 8px;
  overflow: auto;
}
.entries {
  list-style: none;
  padding: 0;
  margin: 0;
}
.entries li {
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.entries li:hover {
  background: var(--color-surface-hover);
}
.entries li.active {
  background: var(--color-tcode-hover-bg);
}
.entries code {
  color: var(--color-text-muted);
}
.commit-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 0 2px;
}
.commit-pagination button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.commit-pagination button:disabled {
  opacity: 0.5;
}
.commit-pagination .status {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.diff-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.filter-row select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.filter-row button {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
}
.selected-doc-label {
  font-size: 13px;
}
.clear-btn {
  color: var(--color-danger);
  border-color: var(--color-danger) !important;
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
