<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <!-- 설계자 요청(2026-09-21) - Documents 탭 우측에 있던 About 카드를
           Code 탭 좌측 패널 맨 위로 옮겼다(다른 탭들과 달리 Code가 프로젝트
           진입 시 첫 화면이라 About이 가장 먼저 눈에 띄어야 한다는 판단). -->
      <ProjectAboutSidebar :project-id="projectId" />
      <q-separator class="q-my-md" />

      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-select v-model="branch" :options="branchNames" dense style="min-width: 140px" label="branch" @update:model-value="onBranchChange" />
        <!-- 설계자 요청(2026-09-21, 항목 9) - 좌측의 "최근 커밋" 목록은 없애고
             이 눈알 아이콘으로 그 브랜치의 커밋 목록을 별도 페이지에서 본다. -->
        <q-btn v-if="branch" flat dense round icon="visibility" size="sm" :to="`/projects/${projectId}/commits?branch=${branch}`">
          <q-tooltip>{{ branch }} 브랜치 최근 커밋 보기</q-tooltip>
        </q-btn>
        <q-btn v-if="path" flat dense icon="arrow_upward" @click="goUp" />
        <div class="text-caption">/{{ path }}</div>
      </div>

      <div v-if="branchNames.length === 0" class="text-caption" style="color: var(--gh-fg-muted)">
        저장소가 비어있습니다(아직 커밋이 없습니다) - Settings의 Template 메뉴에서 배포하면 첫 커밋이 생깁니다.
      </div>
      <q-list v-else bordered separator>
        <q-item v-for="entry in entries" :key="entry.name" clickable @click="openEntry(entry)">
          <q-item-section avatar>
            <q-icon :name="entry.type === 'tree' ? 'folder' : 'description'" :color="entry.type === 'tree' ? 'amber-8' : 'grey-7'" />
          </q-item-section>
          <q-item-section>{{ entry.name }}</q-item-section>
        </q-item>
        <q-item v-if="entries.length === 0"><q-item-section class="text-caption">비어있는 디렉터리입니다.</q-item-section></q-item>
      </q-list>
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col" style="overflow-y: auto">
      <template v-if="currentPath && currentFile">
        <!-- 설계자 요청(2026-09-21, 항목 8) - 우측 뷰어를 탭으로 나눈다:
             파일 내용(탭 이름=파일명만, 경로 제외)/Recent Commits(그
             파일을 실제로 건드린 커밋만). -->
        <q-tabs v-model="rightTab" align="left" dense class="q-px-md" style="border-bottom: 1px solid var(--gh-border)">
          <q-tab name="content" :label="fileNameOf(currentPath)" />
          <q-tab name="commits" label="Recent Commits" />
        </q-tabs>
        <div class="q-pa-md">
          <div v-if="rightTab === 'content'">
            <div v-if="currentFile.isBinary" class="text-caption">바이너리 파일이라 내용을 표시하지 않습니다({{ currentFile.size }} bytes).</div>
            <!-- 설계자 요청(2026-09-21) - 코드 탭의 파일 뷰어/편집기도 다른 곳과
                 동일하게 yiitap 기반 Source View를 쓴다. yiitap은 근본적으로
                 마크다운 편집기라 임의의 소스 파일은 그대로 넣으면 들여쓰기/
                 공백이 문단으로 뭉개진다 - .md가 아닌 파일은 펜스 코드 블록
                 (```lang ... ```)으로 감싸 넣어서 <pre><code>로 보존되게 하고,
                 저장 시 그 펜스를 다시 벗겨 원문만 repo.writeFile로 커밋한다. -->
            <MarkdownSourceView v-else :key="currentPath" :content="sourceViewContent(currentFile)" @save="saveCurrentFile" />
          </div>
          <div v-else>
            <div v-if="fileCommitsLoading" class="text-caption">불러오는 중...</div>
            <q-list v-else bordered separator>
              <q-item v-for="c in fileCommits" :key="c.id" clickable :to="`/projects/${projectId}/commit/${c.id}`">
                <q-item-section>
                  <q-item-label>{{ c.message }}</q-item-label>
                  <q-item-label caption>{{ c.id.slice(0, 8) }} · {{ c.author }} · {{ new Date(c.time).toLocaleString() }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="fileCommits.length === 0"><q-item-section class="text-caption">이 파일을 건드린 커밋이 없습니다.</q-item-section></q-item>
            </q-list>
          </div>
        </div>
      </template>
      <!-- 설계자 요청(2026-09-21, 항목 11) - README.md가 없을 때의 안내
           문구+버튼을 우측 영역 중앙 정렬 + 상단 패딩 200px로. -->
      <div v-else-if="readmeState === 'missing' && !creatingReadme" class="column items-center" style="padding-top: 200px">
        <div class="text-caption q-mb-sm">이 브랜치 루트에 README.md가 없습니다.</div>
        <q-btn color="primary" icon="add" label="README.md 작성하기" @click="creatingReadme = true" />
      </div>
      <div v-else-if="readmeState === 'missing'" class="q-pa-md">
        <MarkdownSourceView content="" start-in-edit @save="saveReadme" @cancel="creatingReadme = false" />
      </div>
      <div v-else class="q-pa-md text-caption">왼쪽에서 파일을 선택하세요.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import ProjectSidebar from "components/ProjectSidebar.vue";
import ProjectAboutSidebar from "components/ProjectAboutSidebar.vue";
import * as api from "src/api/client";

interface BranchInfo {
  name: string;
  tipCommitId: string | null;
}
interface TreeEntry {
  name: string;
  type: "blob" | "tree" | "other";
  oid: string;
}
interface CommitInfo {
  id: string;
  message: string;
  author: string;
  time: string;
}
interface FileContent {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
}

const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();
const route = useRoute();

const branchNames = ref<string[]>([]);
const branch = ref<string | null>(null);
const path = ref("");
const entries = ref<TreeEntry[]>([]);

// 설계자 요청(2026-09-21) - 파일 트리에서 고른 파일이든 루트에서 자동으로
// 보여주는 README든 "지금 우측에 보여줄 파일" 하나의 개념으로 통일했다
// (둘 다 탭 구조를 똑같이 쓰므로).
const currentPath = ref<string | null>(null);
const currentFile = ref<FileContent | null>(null);
const rightTab = ref<"content" | "commits">("content");
const fileCommits = ref<CommitInfo[]>([]);
const fileCommitsLoading = ref(false);

const readmeState = ref<"loading" | "found" | "missing" | "n/a">("loading");
const creatingReadme = ref(false);

function fileNameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function isMarkdownPath(filePath: string): boolean {
  return /\.mdx?$/i.test(filePath);
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  vue: "html",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  py: "python",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  prisma: "prisma",
  toml: "toml",
  rs: "rust",
  go: "go",
  java: "java",
};

function extLangFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "";
}

function wrapAsCodeFence(content: string, lang: string): string {
  return "```" + lang + "\n" + content + "\n```\n";
}

function unwrapCodeFence(markdown: string): string {
  const match = markdown.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  return match ? (match[1] ?? "") : markdown;
}

function sourceViewContent(file: FileContent): string {
  return isMarkdownPath(file.path) ? file.content : wrapAsCodeFence(file.content, extLangFromPath(file.path));
}

async function loadBranches(): Promise<string[]> {
  const result = await api.listBranches(auth.apiKey!, props.projectId);
  if (result.ok) {
    const items = (result.data as { items: BranchInfo[] }).items;
    branchNames.value = items.map((b) => b.name);
    if (!branch.value && branchNames.value.length > 0) branch.value = branchNames.value[0] ?? null;
    return branchNames.value;
  }
  return [];
}

async function loadTree() {
  if (!branch.value) {
    entries.value = [];
    return;
  }
  const result = await api.listTree(auth.apiKey!, props.projectId, branch.value, path.value);
  if (result.ok) entries.value = (result.data as { items: TreeEntry[] }).items;
  await loadReadmeIfAtRoot();
}

// 설계자 요청(2026-09-20): 선택된 파일이 없을 때 "루트"에 README.md가
// 있으면 기본으로 보여준다 - 하위 디렉터리를 보는 중일 땐 이 README
// 처리 자체가 적용되지 않는다("이 브랜치에 README가 없다"는 문구가
// 하위 디렉터리 안에서도 뜨는 건 오해를 부른다), 그냥 "파일을
// 선택하세요"로 되돌아간다("n/a" 상태).
async function loadReadmeIfAtRoot() {
  creatingReadme.value = false;
  if (currentPath.value || !branch.value) {
    readmeState.value = "n/a";
    return;
  }
  if (path.value) {
    readmeState.value = "n/a";
    return;
  }
  const hasReadme = entries.value.some((e) => e.type === "blob" && e.name === "README.md");
  if (!hasReadme) {
    readmeState.value = "missing";
    return;
  }
  const result = await api.readRepoFile(auth.apiKey!, props.projectId, branch.value, "README.md");
  if (result.ok) {
    currentPath.value = "README.md";
    currentFile.value = { path: "README.md", ...(result.data as Omit<FileContent, "path">) };
    readmeState.value = "found";
  } else {
    readmeState.value = "missing";
  }
}

async function saveReadme(markdown: string) {
  if (!branch.value) return;
  const result = await api.writeRepoFile(auth.apiKey!, props.projectId, {
    branch: branch.value,
    path: "README.md",
    content: markdown,
    message: readmeState.value === "found" ? "update README.md" : "add README.md",
  });
  if (result.ok) {
    creatingReadme.value = false;
    currentPath.value = null;
    currentFile.value = null;
    await loadTree();
  }
}

async function saveCurrentFile(markdown: string) {
  if (!branch.value || !currentFile.value) return;
  let raw = isMarkdownPath(currentFile.value.path) ? markdown : unwrapCodeFence(markdown);
  // marked -> turndown 왕복에서 코드 펜스 안 마지막 줄바꿈이 사라진다
  // (검증: node로 직접 왕복시켜 확인) - 원본에 있었으면 되돌려준다,
  // 안 그러면 저장할 때마다 "파일 끝에 줄바꿈 없음"으로 diff가 튄다.
  if (!isMarkdownPath(currentFile.value.path) && currentFile.value.content.endsWith("\n") && !raw.endsWith("\n")) {
    raw += "\n";
  }
  const result = await api.writeRepoFile(auth.apiKey!, props.projectId, {
    branch: branch.value,
    path: currentFile.value.path,
    content: raw,
    message: `update ${currentFile.value.path}`,
  });
  if (result.ok) {
    currentFile.value = { ...currentFile.value, content: raw };
    if (rightTab.value === "commits") await loadFileCommits();
  }
}

async function loadFileCommits() {
  if (!branch.value || !currentPath.value) {
    fileCommits.value = [];
    return;
  }
  fileCommitsLoading.value = true;
  const result = await api.getFileCommits(auth.apiKey!, props.projectId, branch.value, currentPath.value, 30);
  if (result.ok) fileCommits.value = (result.data as { items: CommitInfo[] }).items;
  fileCommitsLoading.value = false;
}

watch(rightTab, (tab) => {
  if (tab === "commits") loadFileCommits();
});
watch(currentPath, () => {
  rightTab.value = "content";
});

function onBranchChange() {
  path.value = "";
  currentPath.value = null;
  currentFile.value = null;
  loadTree();
}

async function openEntry(entry: TreeEntry) {
  if (!branch.value) return;
  const entryPath = path.value ? `${path.value}/${entry.name}` : entry.name;
  if (entry.type === "tree") {
    path.value = entryPath;
    currentPath.value = null;
    currentFile.value = null;
    await loadTree();
    return;
  }
  const result = await api.readRepoFile(auth.apiKey!, props.projectId, branch.value, entryPath);
  if (result.ok) {
    currentPath.value = entryPath;
    currentFile.value = { path: entryPath, ...(result.data as Omit<FileContent, "path">) };
  }
}

function goUp() {
  const parts = path.value.split("/");
  parts.pop();
  path.value = parts.join("/");
  currentPath.value = null;
  currentFile.value = null;
  loadTree();
}

// 설계자 요청(2026-09-21) - DiffViewer의 "코드 트리에서 보기" 버튼이
// ?branch=&path=로 넘어오면 그 브랜치/파일을 곧장 열어준다.
async function openFromQuery() {
  const qBranch = route.query.branch;
  const qPath = route.query.path;
  if (typeof qBranch !== "string" || typeof qPath !== "string") return;
  if (!branchNames.value.includes(qBranch)) return;
  branch.value = qBranch;
  const parts = qPath.split("/");
  parts.pop();
  path.value = parts.join("/");
  await loadTree();
  const result = await api.readRepoFile(auth.apiKey!, props.projectId, qBranch, qPath);
  if (result.ok) {
    currentPath.value = qPath;
    currentFile.value = { path: qPath, ...(result.data as Omit<FileContent, "path">) };
  }
}

onMounted(async () => {
  await loadBranches();
  if (route.query.branch && route.query.path) {
    await openFromQuery();
  } else {
    await loadTree();
  }
});

// 설계자 요청(2026-09-21)의 DiffViewer "코드 트리에서 보기" 링크는 같은
// /code 라우트를 query만 바꿔 가리키므로, Vue Router는 컴포넌트를
// 다시 마운트하지 않고 route.query만 갱신한다 - onMounted 안의 쿼리
// 처리는 그래서 두 번째 클릭부터는 전혀 안 불린다. route.query를 직접
// 지켜보다가 매번 다시 열어준다.
watch(
  () => [route.query.branch, route.query.path],
  ([qBranch, qPath]) => {
    if (typeof qBranch === "string" && typeof qPath === "string") openFromQuery();
  }
);
</script>
